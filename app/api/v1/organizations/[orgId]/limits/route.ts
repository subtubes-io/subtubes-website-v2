import {
  LIMITS,
  authenticateOrgMember,
  corsPreflightResponse,
  jsonResponse,
} from "@/lib/cloud-push/common";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  return jsonResponse(LIMITS);
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
