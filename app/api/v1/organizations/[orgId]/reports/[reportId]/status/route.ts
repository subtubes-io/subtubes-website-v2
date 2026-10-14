import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { DocumentError, readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { reportCompatibility } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string; reportId: string }> }) {
  const { orgId, reportId } = await params;
  return designRequest(request, orgId, async () => {
    const reader = readerCapabilities(request, "report");
    const report = await db.selectFrom("report").selectAll()
      .where("id", "=", reportId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!report) throw new DocumentError(404, "not_found", "Report not found.");
    const compatibility = reportCompatibility(report, reader);
    const rows = await db.selectFrom("reportSnapshot").selectAll()
      .where("reportId", "=", reportId).where("organizationId", "=", orgId).orderBy("number", "asc").execute();
    const snapshotVersions = rows.map((row) => ({
      id: row.id, number: row.number, schemaVersion: row.schemaVersion, contentHash: row.contentHash,
      takenAt: row.takenAt.toISOString(), compatibility: reportCompatibility(row, reader),
    }));
    return jsonResponse({
      revision: report.revision, contentHash: report.contentHash, snapshots: rows.map((row) => row.number),
      ...(reader.explicit ? { schemaVersion: report.schemaVersion, compatibility, snapshotVersions } : {}),
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
