import { randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { LIMITS, containsInlineMedia, normalizeSha256 } from "./common";
import { computeCanonicalContentHash } from "./hash";

const integer = z.number().int().min(0).max(2_147_483_646);
const identifier = z.string().min(1).max(200);
export const versionUploadSchema = z.object({
  uploadId: z.uuid(),
  expectedHeadGeneration: integer,
  deviceLabel: z.string().trim().min(1).max(100).optional(),
  document: z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["swimlane", "system"]),
    schemaVersion: z.literal(LIMITS.supportedDesignSchemaVersions[0]),
    revision: integer.min(1),
    content: z.record(z.string(), z.json()),
    refs: z.object({
      blobs: z.array(z.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/)).max(LIMITS.maxBlobsPerDesign)
        .transform((hashes) => [...new Set(hashes.map(normalizeSha256))].sort()),
    }).strict(),
  }).strict(),
}).strict();
export const preferredSchema = z.object({
  versionId: identifier,
  expectedHeadGeneration: integer,
}).strict();

export type VersionUpload = z.infer<typeof versionUploadSchema>;
type Design = Selectable<Database["design"]>;
type Version = Selectable<Database["designVersion"]>;

export class DesignError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

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

export function parseUpload(value: unknown): VersionUpload {
  const result = versionUploadSchema.safeParse(value);
  if (!result.success) {
    throw new DesignError(422, "invalid_document", "Invalid version upload.", {
      issues: result.error.issues.map(({ path, message }) => ({ path, message })),
    });
  }
  if (containsInlineMedia(result.data.document.content)) {
    throw new DesignError(422, "inline_media", "Upload images as blobs, not inline data URLs.");
  }
  return result.data;
}

export function headState(design: Pick<Design, "id" | "preferredVersionId" | "headGeneration" | "versionCount">) {
  return {
    designId: design.id,
    preferredVersionId: design.preferredVersionId,
    headGeneration: design.headGeneration,
    versionCount: design.versionCount,
  };
}

export function versionMetadata(version: Omit<Version, "content" | "refs" | "requestHash">) {
  return {
    id: version.id, number: version.number, uploadId: version.uploadId,
    contentHash: version.contentHash, authorId: version.authorId,
    deviceLabel: version.deviceLabel, createdAt: version.createdAt.toISOString(),
    name: version.name, kind: version.kind, schemaVersion: version.schemaVersion,
    revision: version.revision,
  };
}

export function versionDocument(version: Version) {
  return {
    ...versionMetadata(version),
    document: {
      name: version.name, kind: version.kind, schemaVersion: version.schemaVersion,
      revision: version.revision, content: JSON.parse(version.content),
      refs: JSON.parse(version.refs),
    },
  };
}

function assertOwner(design: Design, userId: string) {
  if (design.ownerId !== userId) {
    throw new DesignError(403, "forbidden", "Only the owner may save versions or choose the preferred version.");
  }
}

export async function saveDesignVersion(
  database: Kysely<Database>, orgId: string, designId: string, userId: string, upload: VersionUpload,
) {
  if (!identifier.safeParse(designId).success) {
    throw new DesignError(422, "invalid_document", "Invalid design ID.");
  }
  const requestHash = computeCanonicalContentHash(upload);
  const contentHash = computeCanonicalContentHash(upload.document);
  return database.transaction().execute(async (tx) => {
    await tx.insertInto("design").values({
      id: designId, organizationId: orgId, ownerId: userId, preferredVersionId: null,
    }).onConflict((c) => c.doNothing()).execute();
    const design = await tx.selectFrom("design").selectAll()
      .where("id", "=", designId).where("organizationId", "=", orgId)
      .forUpdate().executeTakeFirst();
    if (!design) throw new DesignError(404, "not_found", "Design not found.");
    assertOwner(design, userId);
    if (design.headGeneration === 0 && upload.expectedHeadGeneration !== 0) {
      throw new DesignError(404, "not_found", "No cloud design exists; use expectedHeadGeneration 0 for the first push.");
    }

    const previous = await tx.selectFrom("designVersion").selectAll()
      .where("designId", "=", designId).where("organizationId", "=", orgId)
      .where("uploadId", "=", upload.uploadId).executeTakeFirst();
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new DesignError(409, "upload_id_conflict", "This upload ID was already used with another payload or expected head.");
      }
      return {
        replayed: true, ...headState(design), savedVersion: versionMetadata(previous),
        outcome: design.preferredVersionId === previous.id ? "saved_and_preferred" : "saved_requires_selection",
      };
    }

    const hashes = upload.document.refs.blobs;
    if (hashes.length) {
      const available = await tx.selectFrom("blob").select("hash")
        .where("organizationId", "=", orgId).where("hash", "in", hashes).execute();
      const existing = new Set(available.map((blob) => blob.hash));
      const missing = hashes.filter((hash) => !existing.has(hash));
      if (missing.length) {
        throw new DesignError(422, "missing_blobs", "Upload referenced blobs before saving a version.", { hashes: missing });
      }
    }
    const version = await tx.insertInto("designVersion").values({
      id: randomUUID(), designId, organizationId: orgId, authorId: userId,
      number: design.versionCount + 1, uploadId: upload.uploadId,
      requestHash, contentHash, deviceLabel: upload.deviceLabel ?? null,
      name: upload.document.name, kind: upload.document.kind,
      schemaVersion: upload.document.schemaVersion, revision: upload.document.revision,
      content: JSON.stringify(upload.document.content), refs: JSON.stringify(upload.document.refs),
    }).returningAll().executeTakeFirstOrThrow();
    const elect = design.headGeneration === upload.expectedHeadGeneration;
    const updated = await tx.updateTable("design").set({
      versionCount: version.number, updatedAt: new Date(),
      ...(elect ? { preferredVersionId: version.id, headGeneration: design.headGeneration + 1 } : {}),
    }).where("id", "=", designId).where("organizationId", "=", orgId)
      .returningAll().executeTakeFirstOrThrow();
    return {
      replayed: false, ...headState(updated), savedVersion: versionMetadata(version),
      outcome: elect ? "saved_and_preferred" : "saved_requires_selection",
    };
  });
}

export async function electPreferredVersion(
  database: Kysely<Database>, orgId: string, designId: string, userId: string,
  selection: z.infer<typeof preferredSchema>,
) {
  return database.transaction().execute(async (tx) => {
    const design = await tx.selectFrom("design").selectAll()
      .where("id", "=", designId).where("organizationId", "=", orgId)
      .forUpdate().executeTakeFirst();
    if (!design) throw new DesignError(404, "not_found", "Design not found.");
    assertOwner(design, userId);
    if (design.headGeneration !== selection.expectedHeadGeneration) {
      throw new DesignError(409, "head_conflict", "The preferred version changed; review it before choosing again.", headState(design));
    }
    const version = await tx.selectFrom("designVersion").select("id")
      .where("id", "=", selection.versionId).where("designId", "=", designId)
      .where("organizationId", "=", orgId).executeTakeFirst();
    if (!version) throw new DesignError(404, "not_found", "Version not found in this design.");
    if (design.preferredVersionId === version.id) return headState(design);
    const updated = await tx.updateTable("design").set({
      preferredVersionId: version.id, headGeneration: design.headGeneration + 1, updatedAt: new Date(),
    }).where("id", "=", designId).where("organizationId", "=", orgId)
      .returningAll().executeTakeFirstOrThrow();
    return headState(updated);
  });
}
