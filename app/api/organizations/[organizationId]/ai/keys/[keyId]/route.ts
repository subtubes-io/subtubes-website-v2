import { DashboardError, handleDashboard, NO_STORE, requireMember } from "@/lib/dashboard-api";
import { revokeApiKey } from "@/lib/llm/keys";

// A member revokes their own key; an owner or admin may revoke anyone's key in the organization.
export function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string; keyId: string }> }) {
  return handleDashboard(async () => {
    const { organizationId, keyId } = await params;
    const caller = await requireMember(request, organizationId);
    const revoked = await revokeApiKey({ organizationId, keyId, userId: caller.userId, canManage: caller.canManage });
    if (!revoked) throw new DashboardError("not-found", "No such key.");
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
