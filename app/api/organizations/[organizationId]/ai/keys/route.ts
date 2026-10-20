import { DashboardError, handleDashboard, json, readJson, requireMember } from "@/lib/dashboard-api";
import { countActiveKeys, createApiKey, MAX_KEYS_PER_MEMBER, normalizeLabel } from "@/lib/llm/keys";
import { getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

// Any member creates an API key for themselves in this organization. The key is in this response only.
export function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleDashboard(async () => {
    const { organizationId } = await params;
    const caller = await requireMember(request, organizationId);
    const body = await readJson(request) as { label?: unknown };
    const label = normalizeLabel(body.label);
    if (!label) throw new DashboardError("bad-request", "The label must be 1 to 80 characters.");
    const limit = await getRateLimiter().hit(`user:${caller.userId}:llm-key`, RATE_LIMITS.llmKeyCreation());
    if (!limit.allowed) throw new DashboardError("rate-limited", "Too many keys created. Try again later.", limit.retryAfterSeconds);
    if (await countActiveKeys(caller.userId, organizationId) >= MAX_KEYS_PER_MEMBER) {
      throw new DashboardError("conflict", `You have ${MAX_KEYS_PER_MEMBER} keys in this organization. Revoke one first.`);
    }
    return json(await createApiKey({ userId: caller.userId, organizationId, label }), 201);
  });
}
