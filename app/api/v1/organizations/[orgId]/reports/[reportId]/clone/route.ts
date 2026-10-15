import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { cloneReport } from "@/lib/cloud-push/reports";
import { db } from "@/lib/db/client";

type Context = { params: Promise<{ orgId: string; reportId: string }> };

/** Makes an independent copy of a report, owned by the caller. */
export async function POST(request: Request, { params }: Context) {
  const { orgId, reportId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const result = await cloneReport(db, orgId, reportId, userId, readerCapabilities(request, "report"));
    return jsonResponse(result, 201);
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
