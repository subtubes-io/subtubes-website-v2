import { DashboardError, handleDashboard, json, parseUsdLimit, readJson, requireManager } from "@/lib/dashboard-api";
import { updateOrganizationSettings } from "@/lib/llm/account";
import { findModel } from "@/lib/llm/models";

// An owner or admin sets the organization's monthly AI budget (`monthlyLimitUsd`, null for none) and which catalog models its members
// may use (`enabledModels`). Either may be sent alone.
export function PUT(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleDashboard(async () => {
    const { organizationId } = await params;
    const caller = await requireManager(request, organizationId);
    const body = await readJson(request) as { monthlyLimitUsd?: unknown; enabledModels?: unknown };

    const update: { monthlyLimitMicros?: number | null; enabledModels?: string[] } = {};
    if ("monthlyLimitUsd" in body) update.monthlyLimitMicros = parseUsdLimit(body.monthlyLimitUsd, "The monthly budget");
    if ("enabledModels" in body) {
      const models = body.enabledModels;
      if (!Array.isArray(models) || models.length > 100 || models.some((id) => typeof id !== "string" || !findModel(id))) {
        throw new DashboardError("bad-request", "enabledModels must list models from the catalog.");
      }
      update.enabledModels = [...new Set(models as string[])];
    }
    if (!Object.keys(update).length) throw new DashboardError("bad-request", "Send monthlyLimitUsd or enabledModels.");

    await updateOrganizationSettings({ organizationId, updatedBy: caller.userId, ...update });
    return json({ ok: true });
  });
}
