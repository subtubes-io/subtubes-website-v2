import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { DesignError, designRead, parseUpload, readDesignBody, saveDesign } from "@/lib/cloud-push/designs";
import { db } from "@/lib/db/client";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";

type Context = { params: Promise<{ orgId: string; designId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async () => {
    const design = await db.selectFrom("design").selectAll()
      .where("id", "=", designId).where("organizationId", "=", orgId).executeTakeFirst();
    if (!design) throw new DesignError(404, "not_found", "Design not found.");
    return jsonResponse(designRead(design, readerCapabilities(request, "design")));
  });
}

/** Creates the design or replaces its one current copy. The last push wins. */
export async function PUT(request: Request, { params }: Context) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const upload = parseUpload(await readDesignBody(request));
    const result = await saveDesign(db, orgId, designId, userId, upload, readerCapabilities(request, "design"));
    return jsonResponse(result, result.created ? 201 : 200);
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
