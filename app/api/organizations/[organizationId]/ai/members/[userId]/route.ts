import { DashboardError, handleDashboard, json, parseUsdLimit, readJson, requireManager } from "@/lib/dashboard-api";
import { db } from "@/lib/db/client";
import { updateMemberLimit } from "@/lib/llm/account";

// An owner or admin sets one member's monthly AI cap (`monthlyLimitUsd`, null for none) and whether AI is turned off for them.
export function PUT(request: Request, { params }: { params: Promise<{ organizationId: string; userId: string }> }) {
  return handleDashboard(async () => {
    const { organizationId, userId } = await params;
    const caller = await requireManager(request, organizationId);
    const member = await db.selectFrom("member").select("id").where("organizationId", "=", organizationId).where("userId", "=", userId)
      .executeTakeFirst();
    if (!member) throw new DashboardError("not-found", "That person is not a member of this organization.");

    const body = await readJson(request) as { monthlyLimitUsd?: unknown; disabled?: unknown };
    if (typeof body.disabled !== "boolean") throw new DashboardError("bad-request", "Send disabled as true or false.");
    const monthlyLimitMicros = parseUsdLimit(body.monthlyLimitUsd ?? null, "The member's monthly limit");

    await updateMemberLimit({ organizationId, userId, updatedBy: caller.userId, monthlyLimitMicros, disabled: body.disabled });
    return json({ ok: true });
  });
}
