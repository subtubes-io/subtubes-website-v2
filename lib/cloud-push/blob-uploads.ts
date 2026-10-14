import { randomUUID } from "node:crypto";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { computeSha256 } from "./hash";
import { DocumentError } from "./document-compatibility";
import { readPrivateImage, reportStorageToken } from "./blob-storage";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, validateImage } from "./images";

export const uploadIntentSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.enum(IMAGE_TYPES),
  byteSize: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  resource: z.object({ kind: z.enum(["report", "design"]), id: z.string().min(1).max(200) }).strict(),
}).strict();

const storage = {
  authorize: (options: Parameters<typeof generateClientTokenFromReadWriteToken>[0]) =>
    generateClientTokenFromReadWriteToken({ ...options, token: reportStorageToken() }),
  read: readPrivateImage,
};

export async function issueImageUpload(orgId: string, ownerId: string, value: unknown, provider = storage) {
  const parsed = uploadIntentSchema.safeParse(value);
  if (!parsed.success) throw new DocumentError(422, "invalid_document", "Invalid image upload metadata.", { issues: parsed.error.issues });
  const input = parsed.data;
  const resource = await db.selectFrom(input.resource.kind).select(["ownerId", "organizationId"])
    .where("id", "=", input.resource.id).executeTakeFirst();
  if (resource && (resource.organizationId !== orgId || resource.ownerId !== ownerId)) {
    throw new DocumentError(403, "forbidden", "The upload destination belongs to another owner or organization.");
  }
  const existing = await db.selectFrom("blob").select("hash").where("organizationId", "=", orgId).where("hash", "=", input.hash).executeTakeFirst();
  if (existing) return { state: "ready" as const, hash: existing.hash };
  const id = randomUUID();
  // The signed pathname binds the upload to its organization, intent, and expected hash.
  const pathname = `report-images/${encodeURIComponent(orgId)}/${id}/${input.hash}`;
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const token = await provider.authorize({
    pathname, maximumSizeInBytes: input.byteSize,
    allowedContentTypes: [input.contentType], validUntil: expiresAt.getTime(),
    addRandomSuffix: false, allowOverwrite: false,
  });
  await db.insertInto("blobUpload").values({
    id, organizationId: orgId, ownerId, hash: input.hash, contentType: input.contentType,
    byteSize: input.byteSize, resourceKind: input.resource.kind, resourceId: input.resource.id,
    storagePath: pathname, expiresAt, completedAt: null,
  }).execute();
  return { state: "upload" as const, uploadId: id, pathname, clientToken: token, expiresAt: expiresAt.toISOString(), access: "private" as const };
}

export async function completeImageUpload(orgId: string, ownerId: string, uploadId: string, provider = storage) {
  const intent = await db.selectFrom("blobUpload").selectAll().where("id", "=", uploadId)
    .where("organizationId", "=", orgId).where("ownerId", "=", ownerId).executeTakeFirst();
  if (!intent) throw new DocumentError(404, "not_found", "Image upload not found.");
  if (intent.completedAt) return { state: "ready", hash: intent.hash };
  if (intent.expiresAt.getTime() <= Date.now()) throw new DocumentError(410, "upload_expired", "Request a new image upload; the report has not been published.");
  const bytes = await provider.read(intent.storagePath);
  if (bytes.length !== intent.byteSize || computeSha256(bytes) !== intent.hash) {
    throw new DocumentError(422, "hash_mismatch", "Uploaded image bytes do not match the authorized size and SHA-256.");
  }
  const dimensions = await validateImage(bytes, intent.contentType);
  await db.transaction().execute(async (tx) => {
    await tx.insertInto("blob").values({
      organizationId: orgId, hash: intent.hash, contentType: intent.contentType, byteSize: bytes.length,
      data: null, storagePath: intent.storagePath, ...dimensions,
    }).onConflict((conflict) => conflict.columns(["organizationId", "hash"]).doNothing()).execute();
    await tx.updateTable("blobUpload").set({ completedAt: new Date() }).where("id", "=", uploadId).execute();
  });
  return { state: "ready", hash: intent.hash };
}
