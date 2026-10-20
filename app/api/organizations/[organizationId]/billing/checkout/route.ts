import { BillingError, createCreditCheckout, createSubscriptionCheckout, validCreditAmount } from "@/lib/billing/billing";
import { billingConfigured } from "@/lib/billing/stripe";
import { DashboardError, handleDashboard, json, readJson, requireManager } from "@/lib/dashboard-api";
import { db } from "@/lib/db/client";
import { getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

type Context = { params: Promise<{ organizationId: string }> };

// Starts a Stripe Checkout for credits (`{ kind: "credits", amountUsd }`) or a subscription (`{ kind: "subscription", planId }`).
export function POST(request: Request, { params }: Context) {
  return handleDashboard(async () => {
    const { organizationId } = await params;
    const caller = await requireManager(request, organizationId);
    if (!billingConfigured()) throw new DashboardError("unavailable", "Payments are not set up yet.");
    const limit = await getRateLimiter().hit(`user:${caller.userId}:billing`, RATE_LIMITS.billingSessions());
    if (!limit.allowed) throw new DashboardError("rate-limited", "Too many attempts. Try again later.", limit.retryAfterSeconds);

    const body = await readJson(request) as { kind?: unknown; amountUsd?: unknown; planId?: unknown };
    const { slug } = await db.selectFrom("organization").select("slug").where("id", "=", organizationId).executeTakeFirstOrThrow();
    try {
      const common = { organizationId, slug, userId: caller.userId, email: caller.email };
      if (body.kind === "credits") {
        return json({ url: await createCreditCheckout({ ...common, amountUsd: validCreditAmount(body.amountUsd) }) });
      }
      if (body.kind === "subscription" && typeof body.planId === "string") {
        return json({ url: await createSubscriptionCheckout({ ...common, planId: body.planId }) });
      }
    } catch (error) {
      if (error instanceof BillingError) throw new DashboardError("bad-request", error.message);
      throw error;
    }
    throw new DashboardError("bad-request", "Send { kind: \"credits\", amountUsd } or { kind: \"subscription\", planId }.");
  });
}
