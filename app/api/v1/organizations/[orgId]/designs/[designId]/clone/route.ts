import { corsPreflightResponse, jsonResponse } from "@/lib/cloud-push/common";
import { designRequest } from "@/lib/cloud-push/design-api";
import { cloneDesign } from "@/lib/cloud-push/designs";
import { db } from "@/lib/db/client";
import { readerCapabilities } from "@/lib/cloud-push/document-compatibility";

type Context = { params: Promise<{ orgId: string; designId: string }> };

/** Makes an independent copy of a design, owned by the caller. */
export async function POST(request: Request, { params }: Context) {
  const { orgId, designId } = await params;
  return designRequest(request, orgId, async (userId) => {
    const result = await cloneDesign(db, orgId, designId, userId, readerCapabilities(request, "design"));
    return jsonResponse(result, 201);
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
