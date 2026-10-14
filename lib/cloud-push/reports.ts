import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { LIMITS, containsInlineMedia, normalizeSha256 } from "./common";
import { canonicalJsonStringify } from "./hash";
import {
  DocumentError, assertAttachmentReferences, assertSupportedSchema, jsonObjectSchema, parseStoredJson,
  requireReadableSchema, schemaCompatibility, validateStored, type ReaderCapabilities,
} from "./document-compatibility";

const positiveInteger = z.number().int().min(1).max(2_147_483_647);
const referencesSchema = z.looseObject({
  blobs: z.array(z.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/)).max(LIMITS.maxBlobsPerReport).optional(),
  designs: z.array(z.looseObject({
    id: z.string().min(1).max(200), revision: positiveInteger.optional(),
  })).max(500).optional(),
});
const baseSchema = z.looseObject({
  schemaVersion: z.literal(2),
  contentHash: z.string().min(1).max(200),
  report: jsonObjectSchema,
  refs: referencesSchema.optional(),
});
const reportSchema = baseSchema.extend({
  revision: positiveInteger,
  project: z.looseObject({ name: z.string().min(1).max(200).optional() }).optional(),
});
const snapshotSchema = baseSchema.extend({
  number: positiveInteger,
  takenAt: z.iso.datetime().optional(),
  note: z.string().max(2_000).nullable().optional(),
  commit: z.json().optional(),
});
type ReportUpload = z.infer<typeof reportSchema>;
type SnapshotUpload = z.infer<typeof snapshotSchema>;
type Report = Selectable<Database["report"]>;
type Snapshot = Selectable<Database["reportSnapshot"]>;
const legacyReader: ReaderCapabilities = { versions: [2], explicit: false };

export function parseReportUpload(value: unknown, snapshot: true): SnapshotUpload;
export function parseReportUpload(value: unknown, snapshot?: false): ReportUpload;
export function parseReportUpload(value: unknown, snapshot = false): ReportUpload | SnapshotUpload {
  const marker = z.object({ schemaVersion: z.unknown() }).safeParse(value);
  if (!marker.success) throw new DocumentError(422, "invalid_document", "A report envelope with schemaVersion is required.");
  assertSupportedSchema(marker.data.schemaVersion, "report");
  const result = (snapshot ? snapshotSchema : reportSchema).safeParse(value);
  if (!result.success) {
    throw new DocumentError(422, "invalid_document", "Invalid report document.", {
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    });
  }
  if (containsInlineMedia(result.data.report)) {
    throw new DocumentError(422, "inline_media", "Upload images as blobs, not inline data URLs.");
  }
  assertAttachmentReferences(result.data.report, result.data.refs?.blobs ?? []);
  return result.data;
}

async function lockReport(tx: Transaction<Database>, reportId: string) {
  // Snapshots can arrive before their head; a row lock alone cannot serialize creation.
  await sql`select pg_advisory_xact_lock(hashtextextended(${reportId}, 0))`.execute(tx);
}

async function verifyReferences(tx: Transaction<Database>, orgId: string, refs: ReportUpload["refs"]) {
  const hashes = [...new Set((refs?.blobs ?? []).map(normalizeSha256))];
  if (hashes.length) {
    const existing = await tx.selectFrom("blob").select("hash")
      .where("organizationId", "=", orgId).where("hash", "in", hashes).execute();
    const known = new Set(existing.map((row) => row.hash));
    const missing = hashes.filter((hash) => !known.has(hash));
    if (missing.length) throw new DocumentError(422, "missing_blobs", "Upload referenced blobs before publication.", { hashes: missing });
  }
  const ids = [...new Set((refs?.designs ?? []).map((ref) => ref.id))];
  if (ids.length) {
    const existing = await tx.selectFrom("design").select("id")
      .where("organizationId", "=", orgId).where("id", "in", ids).execute();
    const known = new Set(existing.map((row) => row.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) throw new DocumentError(422, "missing_designs", "Upload referenced designs before publication.", { ids: missing });
  }
}

export function reportDocument(row: Report | Snapshot, reader = legacyReader) {
  requireReadableSchema(row.schemaVersion, "report", reader);
  const report = validateStored(jsonObjectSchema, parseStoredJson(row.report, `report ${row.id}`), row.id);
  const refs = validateStored(referencesSchema, parseStoredJson(row.refs, `report ${row.id} references`), row.id);
  assertAttachmentReferences(report, refs.blobs ?? []);
  if ("commit" in row && row.commit !== null) parseStoredJson(row.commit, `snapshot ${row.id} commit`);
  return report;
}

export function reportCompatibility(row: Report | Snapshot, reader: ReaderCapabilities) {
  let state = schemaCompatibility(row.schemaVersion, "report", reader);
  if (!reader.explicit && state.status === "unsupported") requireReadableSchema(row.schemaVersion, "report", reader);
  if (state.status === "supported") {
    try {
      reportDocument(row, reader);
    } catch (error) {
      if (!(error instanceof DocumentError) || error.code !== "invalid_document") throw error;
      state = { status: "invalid", schemaVersion: row.schemaVersion, message: "Invalid document" };
    }
  }
  return state;
}

export async function saveReport(
  database: Kysely<Database>, orgId: string, reportId: string, userId: string,
  upload: ReportUpload, reader: ReaderCapabilities, ifMatch: string | null, ifNoneMatch: string | null,
) {
  return database.transaction().execute(async (tx) => {
    await lockReport(tx, reportId);
    const existing = await tx.selectFrom("report").selectAll().where("id", "=", reportId).forUpdate().executeTakeFirst();
    if (existing && existing.organizationId !== orgId) throw new DocumentError(404, "not_found", "Report not found.");
    if (existing && existing.ownerId !== userId) throw new DocumentError(403, "forbidden", "Only the report owner may overwrite their own report.");
    const snapshots = await tx.selectFrom("reportSnapshot").select(["ownerId", "organizationId"])
      .where("reportId", "=", reportId).execute();
    if (snapshots.some((row) => row.organizationId !== orgId || row.ownerId !== userId)) {
      throw new DocumentError(403, "forbidden", "Only the snapshot owner may publish this report.");
    }
    if (existing) {
      if (ifNoneMatch === "*" || !ifMatch || !/^[1-9]\d*$/.test(ifMatch) ||
        !Number.isSafeInteger(Number(ifMatch)) || Number(ifMatch) !== existing.revision) {
        throw new DocumentError(409, "revision_conflict", "The report changed; review the current revision.", { currentRevision: existing.revision });
      }
      reportDocument(existing, reader);
    } else if (ifMatch && ifMatch !== "*") {
      throw new DocumentError(404, "not_found", "Report not found.");
    }
    requireReadableSchema(upload.schemaVersion, "report", reader);
    await verifyReferences(tx, orgId, upload.refs);
    const values = {
      projectName: upload.project?.name ?? "Untitled Project", schemaVersion: upload.schemaVersion,
      revision: upload.revision, contentHash: upload.contentHash, report: JSON.stringify(upload.report),
      refs: JSON.stringify(upload.refs ?? { blobs: [], designs: [] }), updatedAt: new Date(),
    };
    if (existing) {
      await tx.updateTable("report").set(values).where("id", "=", reportId).where("organizationId", "=", orgId).execute();
    } else {
      await tx.insertInto("report").values({ ...values, id: reportId, organizationId: orgId, ownerId: userId }).execute();
    }
    return { success: true, reportId, revision: upload.revision };
  });
}

export async function saveReportSnapshot(
  database: Kysely<Database>, orgId: string, reportId: string, userId: string,
  upload: SnapshotUpload, reader: ReaderCapabilities,
) {
  return database.transaction().execute(async (tx) => {
    await lockReport(tx, reportId);
    const report = await tx.selectFrom("report").selectAll().where("id", "=", reportId).forUpdate().executeTakeFirst();
    if (report && report.organizationId !== orgId) throw new DocumentError(404, "not_found", "Report not found.");
    if (report && report.ownerId !== userId) throw new DocumentError(403, "forbidden", "Only the report owner may add snapshots.");
    const siblings = await tx.selectFrom("reportSnapshot").select(["organizationId", "ownerId"])
      .where("reportId", "=", reportId).execute();
    if (siblings.some((row) => row.organizationId !== orgId || row.ownerId !== userId)) {
      throw new DocumentError(403, "forbidden", "Only the snapshot owner may publish this report.");
    }
    const existing = await tx.selectFrom("reportSnapshot").selectAll()
      .where("reportId", "=", reportId).where("organizationId", "=", orgId)
      .where("number", "=", upload.number).executeTakeFirst();
    const refs = upload.refs ?? { blobs: [], designs: [] };
    if (existing) {
      const identical = existing.schemaVersion === upload.schemaVersion && existing.contentHash === upload.contentHash &&
        canonicalJsonStringify(parseStoredJson(existing.report, existing.id)) === canonicalJsonStringify(upload.report) &&
        canonicalJsonStringify(parseStoredJson(existing.refs, existing.id)) === canonicalJsonStringify(refs) &&
        existing.note === (upload.note ?? null) &&
        canonicalJsonStringify(existing.commit === null ? null : parseStoredJson(existing.commit, existing.id)) ===
          canonicalJsonStringify(upload.commit ?? null) &&
        (upload.takenAt === undefined || existing.takenAt.toISOString() === new Date(upload.takenAt).toISOString());
      if (!identical) throw new DocumentError(409, "snapshot_immutable", "Snapshot is write-once; retry the original document.");
      return { success: true, reportId, number: existing.number, contentHash: existing.contentHash };
    }
    requireReadableSchema(upload.schemaVersion, "report", reader);
    if (report) reportDocument(report, reader);
    await verifyReferences(tx, orgId, upload.refs);
    await tx.insertInto("reportSnapshot").values({
      id: randomUUID(), reportId, organizationId: orgId, ownerId: userId, number: upload.number,
      takenAt: upload.takenAt ? new Date(upload.takenAt) : new Date(),
      note: upload.note ?? null, commit: upload.commit == null ? null : JSON.stringify(upload.commit),
      schemaVersion: upload.schemaVersion, contentHash: upload.contentHash,
      report: JSON.stringify(upload.report), refs: JSON.stringify(refs),
    }).execute();
    return { success: true, reportId, number: upload.number, contentHash: upload.contentHash };
  });
}
