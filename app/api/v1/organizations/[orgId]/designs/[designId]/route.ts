import {
  LIMITS,
  authenticateOrgMember,
  containsInlineMedia,
  corsPreflightResponse,
  errorResponse,
  jsonResponse,
  normalizeSha256,
} from "@/lib/cloud-push/common";
import { db } from "@/lib/db/client";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string; designId: string }> }
) {
  const { orgId, designId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const rawBodyText = await request.text();
  if (Buffer.byteLength(rawBodyText, "utf8") > LIMITS.maxDesignDocumentBytes) {
    return errorResponse(
      413,
      "too_large",
      `Design document exceeds size limit of ${LIMITS.maxDesignDocumentBytes} bytes.`
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return errorResponse(422, "invalid_document", "Malformed JSON body.");
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof body.schemaVersion !== "number" ||
    typeof body.revision !== "number" ||
    typeof body.name !== "string" ||
    (body.kind !== "swimlane" && body.kind !== "system") ||
    !body.content
  ) {
    return errorResponse(
      422,
      "invalid_document",
      "Invalid design payload: name, kind ('swimlane'|'system'), revision, schemaVersion, and content are required."
    );
  }

  if (containsInlineMedia(body.content)) {
    return errorResponse(
      422,
      "inline_media",
      "Inline data: URLs are rejected. Reference images by SHA-256 hash instead."
    );
  }

  const blobRefs: string[] = Array.isArray(body.refs?.blobs) ? body.refs.blobs : [];
  if (blobRefs.length > 0) {
    const normalizedBlobs = blobRefs.map(normalizeSha256);
    const existingBlobs = await db
      .selectFrom("blob")
      .select("hash")
      .where("organizationId", "=", orgId)
      .where("hash", "in", normalizedBlobs)
      .execute();

    const existingHashSet = new Set(existingBlobs.map((b) => b.hash));
    const missing = blobRefs.filter((b) => !existingHashSet.has(normalizeSha256(b)));
    if (missing.length > 0) {
      return errorResponse(
        422,
        "missing_blobs",
        "Referenced blobs must be uploaded before creating or updating the design.",
        { hashes: missing }
      );
    }
  }

  const ifMatch = request.headers.get("if-match")?.trim();
  const ifNoneMatch = request.headers.get("if-none-match")?.trim();

  const existing = await db
    .selectFrom("design")
    .selectAll()
    .where("id", "=", designId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  const now = new Date();

  if (existing) {
    if (existing.ownerId !== authResult.user.id) {
      return errorResponse(
        403,
        "forbidden",
        "Only the owner may overwrite their own design."
      );
    }

    if (ifNoneMatch === "*") {
      return errorResponse(
        409,
        "revision_conflict",
        "Design already exists.",
        { currentRevision: existing.revision }
      );
    }

    if (!ifMatch) {
      return errorResponse(
        409,
        "revision_conflict",
        "If-Match header is required to update an existing design.",
        { currentRevision: existing.revision }
      );
    }

    const expectedRevision = parseInt(ifMatch, 10);
    if (Number.isNaN(expectedRevision) || existing.revision !== expectedRevision) {
      return errorResponse(
        409,
        "revision_conflict",
        `Stale write: target revision is ${existing.revision}.`,
        { currentRevision: existing.revision }
      );
    }

    await db
      .updateTable("design")
      .set({
        name: body.name,
        kind: body.kind,
        schemaVersion: body.schemaVersion,
        revision: body.revision,
        content: JSON.stringify(body.content),
        refs: JSON.stringify(body.refs ?? { blobs: [] }),
        updatedAt: now,
      })
      .where("id", "=", designId)
      .where("organizationId", "=", orgId)
      .execute();
  } else {
    if (ifMatch && ifMatch !== "*") {
      return errorResponse(404, "not_found", "Design not found.");
    }

    await db
      .insertInto("design")
      .values({
        id: designId,
        organizationId: orgId,
        ownerId: authResult.user.id,
        name: body.name,
        kind: body.kind,
        schemaVersion: body.schemaVersion,
        revision: body.revision,
        content: JSON.stringify(body.content),
        refs: JSON.stringify(body.refs ?? { blobs: [] }),
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  return jsonResponse({
    success: true,
    designId,
    revision: body.revision,
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
