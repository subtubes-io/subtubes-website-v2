import { LIMITS, corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { readDesignBody } from "@/lib/cloud-push/designs";
import { DocumentError, readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { parseReportUpload, reportDocument, saveReport } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

type Context = { params: Promise<{ orgId: string; reportId: string }> };

export async function PUT(request: Request, { params }: Context) {
  const { orgId, reportId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const upload = parseReportUpload(await readDesignBody(request, LIMITS.maxReportDocumentBytes));
    const result = await saveReport(db, orgId, reportId, userId, upload, readerCapabilities(request, "report"),
      request.headers.get("if-match")?.trim() ?? null, request.headers.get("if-none-match")?.trim() ?? null);
    return jsonResponse(result);
  });
}

export async function GET(request: Request, { params }: Context) {
  const { orgId, reportId } = await params;
  return designRequest(request, orgId, async () => {
    const existing = await db.selectFrom("report").selectAll()
      .where("id", "=", reportId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!existing) throw new DocumentError(404, "not_found", "Report not found.");
    const reader = readerCapabilities(request, "report");
    return jsonResponse({
      id: existing.id, organizationId: existing.organizationId, ownerId: existing.ownerId,
      projectName: existing.projectName, schemaVersion: existing.schemaVersion, revision: existing.revision,
      contentHash: existing.contentHash, report: reportDocument(existing, reader),
      ...(reader.explicit ? { refs: JSON.parse(existing.refs) } : {}),
      createdAt: existing.createdAt.toISOString(), updatedAt: existing.updatedAt.toISOString(),
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
