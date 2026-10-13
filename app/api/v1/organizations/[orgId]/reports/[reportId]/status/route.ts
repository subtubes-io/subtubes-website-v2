import {
  authenticateOrgMember,
  corsPreflightResponse,
  errorResponse,
  jsonResponse,
} from "@/lib/cloud-push/common";
import { db } from "@/lib/db/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; reportId: string }> }
) {
  const { orgId, reportId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  const report = await db
    .selectFrom("report")
    .select(["id", "revision", "contentHash"])
    .where("id", "=", reportId)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();

  if (!report) {
    return errorResponse(404, "not_found", "Report not found.");
  }

  const snapshotRows = await db
    .selectFrom("reportSnapshot")
    .select("number")
    .where("reportId", "=", reportId)
    .where("organizationId", "=", orgId)
    .orderBy("number", "asc")
    .execute();

  const snapshots = snapshotRows.map((s) => s.number);

  return jsonResponse({
    revision: report.revision,
    contentHash: report.contentHash,
    snapshots,
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
