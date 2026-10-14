import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import { db } from "@/lib/db/client";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { versionSummary } from "@/lib/cloud-push/designs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  return designRequest(request, orgId, async () => {
    const { limit, cursor } = designPage(request);
    const reader = readerCapabilities(request, "design");
    let query = db.selectFrom("design")
      .innerJoin("designVersion", (join) => join
        .onRef("designVersion.id", "=", "design.preferredVersionId")
        .onRef("designVersion.designId", "=", "design.id")
        .onRef("designVersion.organizationId", "=", "design.organizationId"))
      .selectAll("designVersion").select([
        "design.ownerId", "design.preferredVersionId", "design.headGeneration",
        "design.versionCount", "design.updatedAt as designUpdatedAt",
      ]).where("design.organizationId", "=", orgId).orderBy("design.id", "asc").limit(limit + 1);
    if (cursor) query = query.where("design.id", ">", cursor);
    const rows = await query.execute();
    const designs = rows.slice(0, limit).map((row) => {
      const metadata = versionSummary(row, reader);
      return {
        id: row.designId, ownerId: row.ownerId, preferredVersionId: row.preferredVersionId,
        headGeneration: row.headGeneration, versionCount: row.versionCount,
        updatedAt: row.designUpdatedAt, name: row.name, kind: row.kind,
        number: row.number, contentHash: row.contentHash,
        ...(reader.explicit ? { schemaVersion: row.schemaVersion } : {}),
        ...("compatibility" in metadata ? { compatibility: metadata.compatibility } : {}),
      };
    });
    return jsonResponse({
      success: true, designs,
      nextCursor: rows.length > limit ? designs[designs.length - 1].id : null,
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
