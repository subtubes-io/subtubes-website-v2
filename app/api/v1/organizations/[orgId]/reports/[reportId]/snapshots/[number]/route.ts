import { randomUUID } from "node:crypto";
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
  {
    params,
  }: {
    params: Promise<{ orgId: string; reportId: string; number: string }>;
  }
) {
  const { orgId, reportId, number: numberParam } = await params;
  const snapshotNumber = parseInt(numberParam, 10);
  if (Number.isNaN(snapshotNumber) || snapshotNumber < 1) {
    return errorResponse(422, "invalid_document", "Snapshot number must be a positive integer.");
  }

  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const existingReport = await db
    .selectFrom("report")
    .select(["id", "ownerId"])
    .where("id", "=", reportId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (existingReport && existingReport.ownerId !== authResult.user.id) {
    return errorResponse(403, "forbidden", "Only the report owner may add snapshots to this report.");
  }

  const rawBodyText = await request.text();
  if (Buffer.byteLength(rawBodyText, "utf8") > LIMITS.maxSnapshotDocumentBytes) {
    return errorResponse(
      413,
      "too_large",
      `Snapshot document exceeds size limit of ${LIMITS.maxSnapshotDocumentBytes} bytes.`
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return errorResponse(422, "invalid_document", "Malformed JSON body.");
  }

  if (!body || typeof body !== "object") {
    return errorResponse(422, "invalid_document", "Snapshot payload must be a JSON object.");
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

  if (body.number !== snapshotNumber) {
    return errorResponse(
      422,
      "invalid_document",
      `Snapshot number in body (${body.number}) does not match URL path parameter (${snapshotNumber}).`
    );
  }

  if (!body.contentHash || typeof body.contentHash !== "string") {
    return errorResponse(422, "invalid_document", "contentHash is required.");
  }

  if (!body.report || typeof body.report !== "object") {
    return errorResponse(422, "invalid_document", "report object is required.");
  }

  if (containsInlineMedia(body.report)) {
    return errorResponse(
      422,
      "inline_media",
      "Inline data: URLs are rejected. Images must be referenced by SHA-256 hash."
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
        "Referenced blobs must be uploaded before creating snapshot.",
        { hashes: missing }
      );
    }
  }

  const existingSnapshot = await db
    .selectFrom("reportSnapshot")
    .select(["id", "contentHash", "ownerId"])
    .where("reportId", "=", reportId)
    .where("organizationId", "=", orgId)
    .where("number", "=", snapshotNumber)
    .executeTakeFirst();

  if (existingSnapshot) {
    if (existingSnapshot.contentHash === body.contentHash) {
      return jsonResponse({
        success: true,
        reportId,
        number: snapshotNumber,
        contentHash: body.contentHash,
      });
    }

    return errorResponse(
      409,
      "snapshot_immutable",
      "Snapshot is write-once and cannot be overwritten with different content."
    );
  }

  const now = new Date();
  const takenAt = body.takenAt ? new Date(body.takenAt) : now;

  await db
    .insertInto("reportSnapshot")
    .values({
      id: randomUUID(),
      reportId,
      organizationId: orgId,
      ownerId: authResult.user.id,
      number: snapshotNumber,
      takenAt,
      note: typeof body.note === "string" ? body.note : null,
      commit: body.commit ? JSON.stringify(body.commit) : null,
      schemaVersion: body.schemaVersion,
      contentHash: body.contentHash,
      report: JSON.stringify(body.report),
      refs: JSON.stringify(body.refs ?? { blobs: [], designs: [] }),
      createdAt: now,
    })
    .execute();

  return jsonResponse({
    success: true,
    reportId,
    number: snapshotNumber,
    contentHash: body.contentHash,
  });
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ orgId: string; reportId: string; number: string }>;
  }
) {
  const { orgId, reportId, number: numberParam } = await params;
  const snapshotNumber = parseInt(numberParam, 10);
  if (Number.isNaN(snapshotNumber) || snapshotNumber < 1) {
    return errorResponse(422, "invalid_document", "Snapshot number must be a positive integer.");
  }

  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const snapshot = await db
    .selectFrom("reportSnapshot")
    .selectAll()
    .where("organizationId", "=", orgId)
    .where("reportId", "=", reportId)
    .where("number", "=", snapshotNumber)
    .executeTakeFirst();

  if (!snapshot) {
    return errorResponse(404, "not_found", `Snapshot #${snapshotNumber} not found.`);
  }

  let reportContent: any = null;
  try {
    reportContent = JSON.parse(snapshot.report);
  } catch {
    reportContent = null;
  }

  let commitData: any = null;
  if (snapshot.commit) {
    try {
      commitData = JSON.parse(snapshot.commit);
    } catch {
      commitData = null;
    }
  }

  return jsonResponse({
    id: snapshot.id,
    reportId: snapshot.reportId,
    number: snapshot.number,
    takenAt: snapshot.takenAt.toISOString(),
    note: snapshot.note,
    commit: commitData,
    schemaVersion: snapshot.schemaVersion,
    contentHash: snapshot.contentHash,
    report: reportContent,
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
