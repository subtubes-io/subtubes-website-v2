import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import {
  DesignError, electPreferredVersion, preferredSchema, readDesignBody,
} from "@/lib/cloud-push/designs";
import { db } from "@/lib/db/client";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string; designId: string }> },
) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const selection = preferredSchema.safeParse(await readDesignBody(request, 4096));
    if (!selection.success) {
      throw new DesignError(422, "invalid_document", "versionId and a nonnegative integer expectedHeadGeneration are required.");
    }
    const result = await electPreferredVersion(db, orgId, designId, userId, selection.data);
    return jsonResponse({ success: true, ...result });
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
