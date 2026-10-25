import { BillingError } from "@/lib/billing/billing";
import { billingConfigured } from "@/lib/billing/stripe";
import { auth } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { createMembershipPortal } from "@/lib/membership/membership";
import { getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

const NO_STORE = { "Cache-Control": "no-store" };

// Opens the Stripe billing portal, where a member updates their card, sees invoices or cancels.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  if (!isTrustedAuthOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Use this website to make this change." }, { status: 403, headers: NO_STORE });
  }
  if (!billingConfigured()) return Response.json({ error: "Payments are not set up yet." }, { status: 503, headers: NO_STORE });

  const limit = await getRateLimiter().hit(`user:${session.user.id}:membership`, RATE_LIMITS.billingSessions());
  if (!limit.allowed) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } });
  }
  try {
    return Response.json({ url: await createMembershipPortal(session.user.id) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.message }, { status: 400, headers: NO_STORE });
    console.error("Unable to open the billing portal", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Could not open the billing portal. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
