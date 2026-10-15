import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designPage, designRequest } from "@/lib/cloud-push/design-api";
import { db } from "@/lib/db/client";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";
import { designSummary } from "@/lib/cloud-push/designs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  return designRequest(request, orgId, async () => {
    const { limit, cursor } = designPage(request);
    const reader = readerCapabilities(request, "design");
    let query = db.selectFrom("design").selectAll()
      .where("organizationId", "=", orgId).orderBy("id", "asc").limit(limit + 1);
    if (cursor) query = query.where("id", ">", cursor);
    const rows = await query.execute();
    const designs = rows.slice(0, limit).map((row) => designSummary(row, reader));
    return jsonResponse({
      success: true, designs,
      nextCursor: rows.length > limit ? designs[designs.length - 1].id : null,
    });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
