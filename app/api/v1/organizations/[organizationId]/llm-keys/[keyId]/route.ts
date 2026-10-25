import { ApiError, handle } from "@/lib/api-v1/errors";
import { authorize, canManage } from "@/lib/api-v1/http";
import { revokeApiKey } from "@/lib/llm/keys";

// Revokes a key (the desktop app does this on sign-out). Owners and admins may revoke any key in the organization.
export function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string; keyId: string }> }) {
  return handle(async () => {
    const { organizationId, keyId } = await params;
    const caller = await authorize(request, organizationId);
    const revoked = await revokeApiKey({ organizationId, keyId, userId: caller.userId, canManage: canManage(caller) });
    if (!revoked) throw new ApiError("key-not-found", "No such key.");
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  });
}
