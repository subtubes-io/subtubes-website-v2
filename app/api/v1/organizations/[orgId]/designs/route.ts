import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import { db } from "@/lib/db/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  return designRequest(request, orgId, async () => {
    const { limit, cursor } = designPage(request);
    let query = db.selectFrom("design")
      .innerJoin("designVersion", (join) => join
        .onRef("designVersion.id", "=", "design.preferredVersionId")
        .onRef("designVersion.designId", "=", "design.id")
        .onRef("designVersion.organizationId", "=", "design.organizationId"))
      .select([
        "design.id", "design.ownerId", "design.preferredVersionId", "design.headGeneration",
        "design.versionCount", "design.updatedAt", "designVersion.name", "designVersion.kind",
        "designVersion.number", "designVersion.contentHash",
      ]).where("design.organizationId", "=", orgId).orderBy("design.id", "asc").limit(limit + 1);
    if (cursor) query = query.where("design.id", ">", cursor);
    const rows = await query.execute();
    const designs = rows.slice(0, limit);
    return jsonResponse({
      success: true, designs,
      nextCursor: rows.length > limit ? designs[designs.length - 1].id : null,
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
