import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { LIMITS, containsInlineMedia, normalizeSha256 } from "./common";
import { computeCanonicalContentHash } from "./hash";
import {
  DocumentError as DesignError, assertAttachmentReferences, assertSupportedSchema, parseStoredJson, requireReadableSchema,
  schemaCompatibility, validateStored, type ReaderCapabilities,
} from "./document-compatibility";
export { DocumentError as DesignError } from "./document-compatibility";

const integer = z.number().int().min(0).max(2_147_483_646);
const identifier = z.string().min(1).max(200);
const documentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["swimlane", "system"]),
  schemaVersion: z.literal(LIMITS.supportedDesignSchemaVersions[0]),
  revision: integer.min(1),
  content: z.record(z.string(), z.json()),
  refs: z.object({
    blobs: z.array(z.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/)).max(LIMITS.maxBlobsPerDesign)
      .transform((hashes) => [...new Set(hashes.map(normalizeSha256))].sort()),
  }).strict(),
}).strict();
/** A design is one current copy: pushing it replaces whatever the cloud held before. */
export const designUploadSchema = z.object({
  deviceLabel: z.string().trim().min(1).max(100).optional(),
  document: documentSchema,
}).strict();

export type DesignUpload = z.infer<typeof designUploadSchema>;
type Design = Selectable<Database["design"]>;
const legacyReader: ReaderCapabilities = { versions: [1], explicit: false };

export async function readDesignBody(request: Request, maxBytes = LIMITS.maxDesignDocumentBytes): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new DesignError(415, "invalid_document", "Send an application/json body.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new DesignError(422, "invalid_document", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new DesignError(413, "too_large", `Design request exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DesignError(422, "invalid_document", "Malformed JSON body.");
  }
}

export function parseUpload(value: unknown): DesignUpload {
  const envelope = z.object({ document: z.object({ schemaVersion: z.unknown() }) }).safeParse(value);
  if (envelope.success) assertSupportedSchema(envelope.data.document.schemaVersion, "design");
  const result = designUploadSchema.safeParse(value);
  if (!result.success) {
    throw new DesignError(422, "invalid_document", "Invalid design upload.", {
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    });
  }
  if (containsInlineMedia(result.data.document.content)) {
    throw new DesignError(422, "inline_media", "Upload images as blobs, not inline data URLs.");
  }
  assertAttachmentReferences(result.data.document.content, result.data.document.refs.blobs);
  return result.data;
}

/** The stored document, checked against its schema, references and hash before anyone sees it or replaces it. */
export function designDocument(design: Design, reader: ReaderCapabilities = legacyReader) {
  requireReadableSchema(design.schemaVersion, "design", reader);
  const document = {
    name: design.name, kind: design.kind, schemaVersion: design.schemaVersion,
    revision: design.revision, content: parseStoredJson(design.content, `design ${design.id}`),
    refs: parseStoredJson(design.refs, `design ${design.id} references`),
  };
  const parsed = validateStored(documentSchema, document, design.id);
  assertAttachmentReferences(document.content, parsed.refs.blobs);
  if (computeCanonicalContentHash(document) !== design.contentHash) {
    console.error("Stored design hash mismatch", design.id);
    throw new DesignError(422, "invalid_document", "Invalid document");
  }
  return parsed;
}

export function designRead(design: Design, reader: ReaderCapabilities = legacyReader) {
  return {
    success: true as const, designId: design.id, ownerId: design.ownerId,
    contentHash: design.contentHash, updatedAt: design.updatedAt.toISOString(),
    document: designDocument(design, reader),
  };
}

export function designSummary(design: Design, reader: ReaderCapabilities) {
  let state = schemaCompatibility(design.schemaVersion, "design", reader);
  if (!reader.explicit && state.status === "unsupported") requireReadableSchema(design.schemaVersion, "design", reader);
  if (state.status === "supported") {
    try {
      designDocument(design, reader);
    } catch (error) {
      if (!(error instanceof DesignError) || error.code !== "invalid_document") throw error;
      state = { status: "invalid", schemaVersion: design.schemaVersion, message: "Invalid document" };
    }
  }
  return {
    id: design.id, ownerId: design.ownerId, name: design.name, kind: design.kind,
    revision: design.revision, contentHash: design.contentHash, updatedAt: design.updatedAt.toISOString(),
    ...(reader.explicit ? { schemaVersion: design.schemaVersion } : {}),
    ...(reader.explicit || state.status === "invalid" ? { compatibility: state } : {}),
  };
}

type Writer = Pick<Kysely<Database>, "selectFrom">;
async function requireBlobs(tx: Writer, orgId: string, hashes: readonly string[]) {
  if (!hashes.length) return;
  const available = await tx.selectFrom("blob").select("hash")
    .where("organizationId", "=", orgId).where("hash", "in", [...hashes]).execute();
  const existing = new Set(available.map((blob) => blob.hash));
  const missing = hashes.filter((hash) => !existing.has(hash));
  if (missing.length) throw new DesignError(422, "missing_blobs", "Upload referenced blobs before saving the design.", { hashes: missing });
}

/** Creates the design, or replaces its one current copy. Only the owner may replace it, and a copy this reader cannot read is never overwritten. */
export async function saveDesign(
  database: Kysely<Database>, orgId: string, designId: string, userId: string, upload: DesignUpload,
  reader: ReaderCapabilities = legacyReader,
) {
  if (!identifier.safeParse(designId).success) throw new DesignError(422, "invalid_document", "Invalid design ID.");
  const contentHash = computeCanonicalContentHash(upload.document);
  const { document } = upload;
  const values = {
    name: document.name, kind: document.kind, schemaVersion: document.schemaVersion, revision: document.revision,
    content: JSON.stringify(document.content), refs: JSON.stringify(document.refs),
    contentHash, deviceLabel: upload.deviceLabel ?? null,
  };
  return database.transaction().execute(async (tx) => {
    requireReadableSchema(document.schemaVersion, "design", reader);
    await requireBlobs(tx, orgId, document.refs.blobs);
    const find = () => tx.selectFrom("design").selectAll().where("id", "=", designId).forUpdate().executeTakeFirst();
    let existing = await find();
    if (!existing) {
      const inserted = await tx.insertInto("design").values({ ...values, id: designId, organizationId: orgId, ownerId: userId })
        .onConflict((conflict) => conflict.column("id").doNothing()).returning(["id", "updatedAt"]).executeTakeFirst();
      if (inserted) return { success: true as const, designId, contentHash, updatedAt: inserted.updatedAt.toISOString(), created: true };
      existing = await find();
    }
    if (!existing || existing.organizationId !== orgId) throw new DesignError(404, "not_found", "Design not found.");
    if (existing.ownerId !== userId) throw new DesignError(403, "forbidden", "Only the owner may replace this design. Clone it to keep your own copy.");
    designDocument(existing, reader);
    const updated = await tx.updateTable("design").set({ ...values, updatedAt: new Date() })
      .where("id", "=", designId).where("organizationId", "=", orgId).returning("updatedAt").executeTakeFirstOrThrow();
    return { success: true as const, designId, contentHash, updatedAt: updated.updatedAt.toISOString(), created: false };
  });
}

/** An independent copy owned by the caller: a new ID, named "Copy of ...", at revision 1. */
export async function cloneDesign(
  database: Kysely<Database>, orgId: string, designId: string, userId: string,
  reader: ReaderCapabilities = legacyReader,
) {
  return database.transaction().execute(async (tx) => {
    const source = await tx.selectFrom("design").selectAll()
      .where("id", "=", designId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!source) throw new DesignError(404, "not_found", "Design not found.");
    const original = designDocument(source, reader);
    const name = `Copy of ${original.name}`.slice(0, 200);
    const document = { ...original, name, revision: 1, content: { ...original.content, name } };
    const id = randomUUID();
    const contentHash = computeCanonicalContentHash(document);
    const inserted = await tx.insertInto("design").values({
      id, organizationId: orgId, ownerId: userId, name, kind: document.kind, schemaVersion: document.schemaVersion,
      revision: 1, content: JSON.stringify(document.content), refs: JSON.stringify(document.refs), contentHash, deviceLabel: null,
    }).returning("updatedAt").executeTakeFirstOrThrow();
    return { success: true as const, designId: id, name, contentHash, updatedAt: inserted.updatedAt.toISOString(), created: true };
  });
}
