import { randomUUID } from "node:crypto";
import { type Kysely, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { LIMITS, containsInlineMedia, normalizeSha256 } from "./common";
import { computeCanonicalContentHash } from "./hash";
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
const reportSchema = z.looseObject({
  schemaVersion: z.literal(2),
  contentHash: z.string().min(1).max(200),
  report: jsonObjectSchema,
  refs: referencesSchema.optional(),
  revision: positiveInteger,
  project: z.looseObject({ name: z.string().min(1).max(200).optional() }).optional(),
});
type ReportUpload = z.infer<typeof reportSchema>;
type Report = Selectable<Database["report"]>;
const legacyReader: ReaderCapabilities = { versions: [2], explicit: false };

export function parseReportUpload(value: unknown): ReportUpload {
  const marker = z.object({ schemaVersion: z.unknown() }).safeParse(value);
  if (!marker.success) throw new DocumentError(422, "invalid_document", "A report envelope with schemaVersion is required.");
  assertSupportedSchema(marker.data.schemaVersion, "report");
  const result = reportSchema.safeParse(value);
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

export function reportDocument(row: Report, reader = legacyReader) {
  requireReadableSchema(row.schemaVersion, "report", reader);
  const report = validateStored(jsonObjectSchema, parseStoredJson(row.report, `report ${row.id}`), row.id);
  const refs = validateStored(referencesSchema, parseStoredJson(row.refs, `report ${row.id} references`), row.id);
  assertAttachmentReferences(report, refs.blobs ?? []);
  return report;
}

export function reportCompatibility(row: Report, reader: ReaderCapabilities) {
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

/** Creates the report, or replaces its one current copy. The last push wins; only the owner may replace it. */
export async function saveReport(
  database: Kysely<Database>, orgId: string, reportId: string, userId: string,
  upload: ReportUpload, reader: ReaderCapabilities,
) {
  return database.transaction().execute(async (tx) => {
    const existing = await tx.selectFrom("report").selectAll().where("id", "=", reportId).forUpdate().executeTakeFirst();
    if (existing && existing.organizationId !== orgId) throw new DocumentError(404, "not_found", "Report not found.");
    if (existing && existing.ownerId !== userId) {
      throw new DocumentError(403, "forbidden", "Only the report owner may replace it. Clone it to keep your own copy.");
    }
    // A copy this reader cannot read (a newer schema, or damaged) is never replaced.
    if (existing) reportDocument(existing, reader);
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

/** An independent copy owned by the caller: a new ID, titled "Copy of ...", at revision 1. */
export async function cloneReport(
  database: Kysely<Database>, orgId: string, reportId: string, userId: string,
  reader: ReaderCapabilities = legacyReader,
) {
  return database.transaction().execute(async (tx) => {
    const source = await tx.selectFrom("report").selectAll()
      .where("id", "=", reportId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!source) throw new DocumentError(404, "not_found", "Report not found.");
    const original = reportDocument(source, reader);
    const title = typeof original.title === "string" && original.title.trim() ? original.title : source.projectName;
    const name = `Copy of ${title}`.slice(0, 200);
    const report = { ...original, title: name };
    const refs = parseStoredJson(source.refs, `report ${source.id} references`);
    const id = randomUUID();
    const contentHash = computeCanonicalContentHash({ schemaVersion: source.schemaVersion, report, refs });
    const inserted = await tx.insertInto("report").values({
      id, organizationId: orgId, ownerId: userId, projectName: `Copy of ${source.projectName}`.slice(0, 200),
      schemaVersion: source.schemaVersion, revision: 1, contentHash,
      report: JSON.stringify(report), refs: JSON.stringify(refs),
    }).returning("updatedAt").executeTakeFirstOrThrow();
    return { success: true as const, reportId: id, name, revision: 1, contentHash, updatedAt: inserted.updatedAt.toISOString() };
  });
}
