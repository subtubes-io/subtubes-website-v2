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
  { params }: { params: Promise<{ orgId: string; reportId: string }> }
) {
  const { orgId, reportId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const rawBodyText = await request.text();
  if (Buffer.byteLength(rawBodyText, "utf8") > LIMITS.maxReportDocumentBytes) {
    return errorResponse(
      413,
      "too_large",
      `Report document exceeds size limit of ${LIMITS.maxReportDocumentBytes} bytes.`
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return errorResponse(422, "invalid_document", "Malformed JSON body.");
  }

  if (!body || typeof body !== "object") {
    return errorResponse(422, "invalid_document", "Report payload must be a JSON object.");
  }

  if (
    typeof body.schemaVersion !== "number" ||
    !LIMITS.supportedSchemaVersions.includes(body.schemaVersion as (typeof LIMITS.supportedSchemaVersions)[number])
  ) {
    return errorResponse(
      422,
      "unsupported_schema_version",
      `Unsupported schemaVersion ${body.schemaVersion}. Supported versions: ${LIMITS.supportedSchemaVersions.join(", ")}.`,
      { supported: LIMITS.supportedSchemaVersions }
    );
  }

  if (typeof body.revision !== "number" || body.revision < 1) {
    return errorResponse(422, "invalid_document", "revision must be a positive integer.");
  }

  if (!body.contentHash || typeof body.contentHash !== "string") {
    return errorResponse(422, "invalid_document", "contentHash is required.");
  }

  if (!body.report || typeof body.report !== "object") {
    return errorResponse(422, "invalid_document", "report document is required.");
  }

  if (containsInlineMedia(body.report)) {
    return errorResponse(
      422,
      "inline_media",
      "Inline data: URLs are rejected. Images must be referenced by SHA-256 hash."
    );
  }

  const blobRefs: string[] = Array.isArray(body.refs?.blobs) ? body.refs.blobs : [];
  if (blobRefs.length > LIMITS.maxBlobsPerReport) {
    return errorResponse(
      413,
      "too_large",
      `Report references ${blobRefs.length} blobs, which exceeds the limit of ${LIMITS.maxBlobsPerReport}.`
    );
  }

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
        "Referenced blobs must be uploaded before creating or updating the report head.",
        { hashes: missing }
      );
    }
  }

  const designRefs: { id: string; revision?: number }[] = Array.isArray(body.refs?.designs)
    ? body.refs.designs
    : [];

  if (designRefs.length > 0) {
    const designIds = designRefs.map((d) => d.id).filter(Boolean);
    if (designIds.length > 0) {
      const existingDesigns = await db
        .selectFrom("design")
        .select("id")
        .where("organizationId", "=", orgId)
        .where("id", "in", designIds)
        .execute();

      const existingDesignSet = new Set(existingDesigns.map((d) => d.id));
      const missingDesignIds = designIds.filter((id) => !existingDesignSet.has(id));
      if (missingDesignIds.length > 0) {
        return errorResponse(
          422,
          "missing_designs",
          "Referenced designs must be uploaded before creating or updating the report head.",
          { ids: missingDesignIds }
        );
      }
    }
  }

  const ifMatch = request.headers.get("if-match")?.trim();
  const ifNoneMatch = request.headers.get("if-none-match")?.trim();

  const existing = await db
    .selectFrom("report")
    .selectAll()
    .where("id", "=", reportId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  const now = new Date();
  const projectName = body.project?.name || "Untitled Project";

  if (existing) {
    if (existing.ownerId !== authResult.user.id) {
      return errorResponse(
        403,
        "forbidden",
        "Only the report owner may overwrite their own report."
      );
    }

    if (ifNoneMatch === "*") {
      return errorResponse(
        409,
        "revision_conflict",
        "Report already exists.",
        { currentRevision: existing.revision }
      );
    }

    if (!ifMatch) {
      return errorResponse(
        409,
        "revision_conflict",
        "If-Match header is required to update an existing report.",
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
      .updateTable("report")
      .set({
        projectName,
        schemaVersion: body.schemaVersion,
        revision: body.revision,
        contentHash: body.contentHash,
        report: JSON.stringify(body.report),
        refs: JSON.stringify(body.refs ?? { blobs: [], designs: [] }),
        updatedAt: now,
      })
      .where("id", "=", reportId)
      .where("organizationId", "=", orgId)
      .execute();
  } else {
    if (ifMatch && ifMatch !== "*") {
      return errorResponse(404, "not_found", "Report not found.");
    }

    await db
      .insertInto("report")
      .values({
        id: reportId,
        organizationId: orgId,
        ownerId: authResult.user.id,
        projectName,
        schemaVersion: body.schemaVersion,
        revision: body.revision,
        contentHash: body.contentHash,
        report: JSON.stringify(body.report),
        refs: JSON.stringify(body.refs ?? { blobs: [], designs: [] }),
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  return jsonResponse({
    success: true,
    reportId,
    revision: body.revision,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; reportId: string }> }
) {
  const { orgId, reportId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const existing = await db
    .selectFrom("report")
    .selectAll()
    .where("id", "=", reportId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!existing) {
    return errorResponse(404, "not_found", "Report not found.");
  }

  let reportContent: any = null;
  try {
    reportContent = JSON.parse(existing.report);
  } catch {
    reportContent = null;
  }

  return jsonResponse({
    id: existing.id,
    organizationId: existing.organizationId,
    ownerId: existing.ownerId,
    projectName: existing.projectName,
    schemaVersion: existing.schemaVersion,
    revision: existing.revision,
    contentHash: existing.contentHash,
    report: reportContent,
    createdAt: existing.createdAt.toISOString(),
    updatedAt: existing.updatedAt.toISOString(),
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
