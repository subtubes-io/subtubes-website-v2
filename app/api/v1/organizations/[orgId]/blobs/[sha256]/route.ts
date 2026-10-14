import {
  LIMITS,
  authenticateOrgMember,
  computeSha256,
  corsPreflightResponse,
  errorResponse,
  jsonResponse,
  normalizeSha256,
} from "@/lib/cloud-push/common";
import { db } from "@/lib/db/client";
import { readImageBody, validateImage } from "@/lib/cloud-push/images";
import { storedImageBytes } from "@/lib/cloud-push/blob-storage";
import { DocumentError } from "@/lib/cloud-push/document-compatibility";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string; sha256: string }> }
) {
  const { orgId, sha256 } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const rawContentType = request.headers.get("content-type") || "";
  const contentType = rawContentType.split(";")[0].trim().toLowerCase();

  if (!LIMITS.allowedBlobTypes.includes(contentType as (typeof LIMITS.allowedBlobTypes)[number])) {
    return errorResponse(
      422,
      "invalid_document",
      `Invalid Content-Type '${rawContentType}'. Allowed types: ${LIMITS.allowedBlobTypes.join(", ")}.`
    );
  }

  let buffer: Buffer;
  let dimensions: { width: number; height: number };
  try {
    buffer = await readImageBody(request);
    dimensions = await validateImage(buffer, contentType);
  } catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    throw error;
  }

  const computedHash = computeSha256(buffer);
  const expectedHash = normalizeSha256(sha256);

  if (computedHash !== expectedHash) {
    return errorResponse(
      422,
      "hash_mismatch",
      "SHA-256 digest of uploaded body does not match hash in URL path."
    );
  }

  const existing = await db
    .selectFrom("blob")
    .select("hash")
    .where("organizationId", "=", orgId)
    .where("hash", "=", expectedHash)
    .executeTakeFirst();

  if (!existing) {
    await db
      .insertInto("blob")
      .values({
        organizationId: orgId,
        hash: expectedHash,
        contentType,
        byteSize: buffer.length,
        data: buffer,
        storagePath: null,
        ...dimensions,
        createdAt: new Date(),
      })
      .onConflict((conflict) => conflict.columns(["organizationId", "hash"]).doNothing()).execute();
  }

  return jsonResponse({
    success: true,
    hash: expectedHash,
    byteSize: buffer.length,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; sha256: string }> }
) {
  const { orgId, sha256 } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const expectedHash = normalizeSha256(sha256);
  const blob = await db
    .selectFrom("blob")
    .select(["contentType", "byteSize", "data", "storagePath"])
    .where("organizationId", "=", orgId)
    .where("hash", "=", expectedHash)
    .executeTakeFirst();

  if (!blob) {
    return errorResponse(404, "not_found", `Blob ${expectedHash} not found in organization.`);
  }

  let bytes: Buffer;
  try { bytes = await storedImageBytes(blob); }
  catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    console.error("Unable to read report image", error);
    return errorResponse(503, "storage_unavailable", "Unable to read image storage.");
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": String(blob.byteSize),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
