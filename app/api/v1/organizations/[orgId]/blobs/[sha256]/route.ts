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

  const arrayBuffer = await request.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > LIMITS.maxBlobBytes) {
    return errorResponse(
      413,
      "too_large",
      `Blob size exceeds maximum allowed limit of ${LIMITS.maxBlobBytes} bytes.`
    );
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
        createdAt: new Date(),
      })
      .execute();
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
    .select(["contentType", "byteSize", "data"])
    .where("organizationId", "=", orgId)
    .where("hash", "=", expectedHash)
    .executeTakeFirst();

  if (!blob) {
    return errorResponse(404, "not_found", `Blob ${expectedHash} not found in organization.`);
  }

  return new Response(new Uint8Array(blob.data), {
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
