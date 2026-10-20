import { BillingError, createPortalSession } from "@/lib/billing/billing";
import { billingConfigured } from "@/lib/billing/stripe";
import { DashboardError, handleDashboard, json, requireManager } from "@/lib/dashboard-api";
import { db } from "@/lib/db/client";
import { getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

// Opens Stripe's billing portal, where an owner or admin changes the card, cancels the subscription or downloads invoices.
export function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  return handleDashboard(async () => {
    const { organizationId } = await params;
    const caller = await requireManager(request, organizationId);
    if (!billingConfigured()) throw new DashboardError("unavailable", "Payments are not set up yet.");
    const limit = await getRateLimiter().hit(`user:${caller.userId}:billing`, RATE_LIMITS.billingSessions());
    if (!limit.allowed) throw new DashboardError("rate-limited", "Too many attempts. Try again later.", limit.retryAfterSeconds);
    const { slug } = await db.selectFrom("organization").select("slug").where("id", "=", organizationId).executeTakeFirstOrThrow();
    try {
      return json({ url: await createPortalSession({ organizationId, slug }) });
    } catch (error) {
      if (error instanceof BillingError) throw new DashboardError("bad-request", error.message);
      throw error;
    }
  });
}
