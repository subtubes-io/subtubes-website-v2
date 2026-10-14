import { LIMITS, corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { readDesignBody } from "@/lib/cloud-push/designs";
import { DocumentError, parseStoredJson, readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { parseReportUpload, reportDocument, saveReportSnapshot } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

type Context = { params: Promise<{ orgId: string; reportId: string; number: string }> };

function snapshotNumber(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483_647) {
    throw new DocumentError(422, "invalid_document", "Snapshot number must be a positive integer.");
  }
  return Number(value);
}

export async function PUT(request: Request, { params }: Context) {
  const { orgId, reportId, number } = await params;
  return designRequest(request, orgId, async (userId) => {
    const upload = parseReportUpload(await readDesignBody(request, LIMITS.maxSnapshotDocumentBytes), true);
    if (upload.number !== snapshotNumber(number)) {
      throw new DocumentError(422, "invalid_document", "Snapshot number must match the URL.");
    }
    return jsonResponse(await saveReportSnapshot(db, orgId, reportId, userId, upload, readerCapabilities(request, "report")));
  });
}

export async function GET(request: Request, { params }: Context) {
  const { orgId, reportId, number } = await params;
  return designRequest(request, orgId, async () => {
    const snapshot = await db.selectFrom("reportSnapshot").selectAll()
      .where("organizationId", "=", orgId).where("reportId", "=", reportId)
      .where("number", "=", snapshotNumber(number)).executeTakeFirst();
    if (!snapshot) throw new DocumentError(404, "not_found", "Snapshot not found.");
    const reader = readerCapabilities(request, "report");
    return jsonResponse({
      id: snapshot.id, reportId: snapshot.reportId, number: snapshot.number,
      takenAt: snapshot.takenAt.toISOString(), note: snapshot.note,
      schemaVersion: snapshot.schemaVersion, contentHash: snapshot.contentHash,
      report: reportDocument(snapshot, reader),
      ...(reader.explicit ? { refs: JSON.parse(snapshot.refs) } : {}),
      commit: snapshot.commit === null ? null : parseStoredJson(snapshot.commit, snapshot.id),
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
