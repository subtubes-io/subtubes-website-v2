import { authenticateOrgMember, corsPreflightResponse, errorResponse, jsonResponse } from "@/lib/cloud-push/common";
import { issueImageUpload } from "@/lib/cloud-push/blob-uploads";
import { DocumentError } from "@/lib/cloud-push/document-compatibility";
import { readDesignBody } from "@/lib/cloud-push/designs";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const auth = await authenticateOrgMember(request, orgId);
  if ("error" in auth) return auth.error;
  try {
    return jsonResponse(await issueImageUpload(orgId, auth.user.id, await readDesignBody(request, 4096)));
  } catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    console.error("Unable to authorize image upload", error);
    return errorResponse(503, "storage_unavailable", "Unable to authorize image storage. Retry; local work is preserved.");
  }
}

export const OPTIONS = corsPreflightResponse;
