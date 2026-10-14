import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import { DocumentError, readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { reportCompatibility } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

export async function GET(request: Request, { params }: { params: Promise<{ orgId: string; reportId: string }> }) {
  const { orgId, reportId } = await params;
  return designRequest(request, orgId, async () => {
    const reader = readerCapabilities(request, "report");
    const { limit, cursor } = designPage(request, true);
    let query = db.selectFrom("reportSnapshot").selectAll()
      .where("organizationId", "=", orgId).where("reportId", "=", reportId)
      .orderBy("number", "desc").limit(limit + 1);
    if (cursor) query = query.where("number", "<", Number(cursor));
    const rows = await query.execute();
    if (!rows.length) {
      const report = await db.selectFrom("report").select("id")
        .where("organizationId", "=", orgId).where("id", "=", reportId).executeTakeFirst();
      const snapshot = await db.selectFrom("reportSnapshot").select("id")
        .where("organizationId", "=", orgId).where("reportId", "=", reportId).executeTakeFirst();
      if (!report && !snapshot) throw new DocumentError(404, "not_found", "Report not found.");
    }
    const snapshots = rows.slice(0, limit).map((row) => ({
      id: row.id, reportId: row.reportId, number: row.number, schemaVersion: row.schemaVersion,
      contentHash: row.contentHash, takenAt: row.takenAt.toISOString(), note: row.note,
      compatibility: reportCompatibility(row, reader),
    }));
    return jsonResponse({
      success: true, reportId, snapshots,
      nextCursor: rows.length > limit ? String(snapshots.at(-1)!.number) : null,
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
