import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { DesignError, versionDocument } from "@/lib/cloud-push/designs";
import { db } from "@/lib/db/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; designId: string; versionId: string }> },
) {
  const { orgId, designId, versionId } = await params;
  return designRequest(request, orgId, async () => {
    const version = await db.selectFrom("designVersion").selectAll()
      .where("id", "=", versionId).where("designId", "=", designId)
      .where("organizationId", "=", orgId).executeTakeFirst();
    if (!version) throw new DesignError(404, "not_found", "Version not found in this design.");
    return jsonResponse({ success: true, designId, version: versionDocument(version) });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
