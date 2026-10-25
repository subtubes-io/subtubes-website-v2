import type Stripe from "stripe";
import type { Transaction } from "kysely";
import { db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { BillingError } from "@/lib/billing/billing";
import { stripe } from "@/lib/billing/stripe";
import { hasMembership, membershipPriceData, type MembershipInterval } from "./plan";

export function getMembership(userId: string) {
  return db.selectFrom("membership").selectAll().where("userId", "=", userId).executeTakeFirst();
}

const pageUrl = () => `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard/membership`;

/** The person's Stripe customer, created on first use. */
async function ensureCustomer(userId: string, email: string, name: string): Promise<string> {
  const existing = await getMembership(userId);
  if (existing) return existing.stripeCustomerId;
  const customer = await stripe().customers.create({ name, email, metadata: { userId } }, { idempotencyKey: `membership-customer-${userId}` });
  await db.insertInto("membership").values({ userId, stripeCustomerId: customer.id })
    .onConflict((conflict) => conflict.column("userId").doNothing()).execute();
  return (await getMembership(userId))!.stripeCustomerId;
}

export async function createMembershipCheckout(user: { id: string; email: string; name: string }, interval: MembershipInterval): Promise<string> {
  if (hasMembership((await getMembership(user.id))?.status)) throw new BillingError("You are already a member. Manage it from the billing portal.");
  const customer = await ensureCustomer(user.id, user.email, user.name);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ quantity: 1, price_data: membershipPriceData(interval) }],
    metadata: { kind: "membership", userId: user.id, interval },
    subscription_data: { metadata: { kind: "membership", userId: user.id } },
    success_url: `${pageUrl()}?checkout=success`,
    cancel_url: `${pageUrl()}?checkout=cancelled`,
  }, {
    // Repeated clicks within half an hour reuse one checkout instead of opening several that could each start a subscription.
    idempotencyKey: `membership-checkout-${user.id}-${interval}-${Math.floor(Date.now() / 1_800_000)}`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createMembershipPortal(userId: string): Promise<string> {
  const membership = await getMembership(userId);
  if (!membership || membership.status === "none") throw new BillingError("There is nothing to manage yet. Become a member first.");
  const session = await stripe().billingPortal.sessions.create({ customer: membership.stripeCustomerId, return_url: pageUrl() });
  return session.url;
}

/** Records a membership subscription's current state (read from Stripe by the webhook, so event order does not matter). */
export async function applyMembershipSubscription(trx: Transaction<Database>, subscription: Stripe.Subscription): Promise<boolean> {
  const userId = subscription.metadata?.userId;
  if (!userId) return false;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const current = await trx.selectFrom("membership").selectAll().where("userId", "=", userId).forUpdate().executeTakeFirst();
  if (!current || current.stripeCustomerId !== customerId) return false;

  // An event about another subscription must not overwrite the current one.
  if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subscription.id && hasMembership(current.status)) {
    if (hasMembership(subscription.status)) {
      // Two checkouts completed: the person pays twice. Needs a cancel and refund in Stripe.
      console.error("Duplicate membership subscription; cancel and refund it in Stripe", userId, subscription.id);
    }
    return false;
  }

  const ended = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  const periodEnd = subscription.items?.data?.[0]?.current_period_end;
  await trx.updateTable("membership").set(ended
    ? { status: "canceled", stripeSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, updatedAt: new Date() }
    : {
      status: subscription.status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      updatedAt: new Date(),
    }).where("userId", "=", userId).execute();
  return true;
}
