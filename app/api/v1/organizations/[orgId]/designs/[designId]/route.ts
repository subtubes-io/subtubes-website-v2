import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { DesignError, headState, versionDocument } from "@/lib/cloud-push/designs";
import { db } from "@/lib/db/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; designId: string }> },
) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async () => {
    const result = await db.selectFrom("design")
      .innerJoin("designVersion", (join) => join
        .onRef("designVersion.id", "=", "design.preferredVersionId")
        .onRef("designVersion.designId", "=", "design.id")
        .onRef("designVersion.organizationId", "=", "design.organizationId"))
      .selectAll("designVersion")
      .select(["design.headGeneration", "design.versionCount", "design.preferredVersionId", "design.ownerId"])
      .where("design.id", "=", designId).where("design.organizationId", "=", orgId)
      .executeTakeFirst();
    if (!result) throw new DesignError(404, "not_found", "Preferred design not found.");
    return jsonResponse({
      success: true,
      ...headState({ ...result, id: designId }),
      version: versionDocument(result),
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
