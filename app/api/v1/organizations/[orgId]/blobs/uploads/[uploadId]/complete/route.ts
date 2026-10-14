import { authenticateOrgMember, corsPreflightResponse, errorResponse, jsonResponse } from "@/lib/cloud-push/common";
import { completeImageUpload } from "@/lib/cloud-push/blob-uploads";
import { DocumentError } from "@/lib/cloud-push/document-compatibility";

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string; uploadId: string }> }) {
  const { orgId, uploadId } = await params;
  const auth = await authenticateOrgMember(request, orgId);
  if ("error" in auth) return auth.error;
  try {
    return jsonResponse(await completeImageUpload(orgId, auth.user.id, uploadId));
  } catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    console.error("Unable to finalize image upload", error);
    return errorResponse(503, "storage_unavailable", "Image verification failed. Retry before publishing the report.");
  }
}

export const OPTIONS = corsPreflightResponse;
