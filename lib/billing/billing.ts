import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { sql, type Transaction } from "kysely";
import { db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { ensureAccount, getAccount, hasActiveSubscription } from "@/lib/llm/account";
import { findPlan, findPlanByPrice, MAX_CREDIT_USD, MIN_CREDIT_USD, stripe } from "./stripe";

type Trx = Transaction<Database>;

export class BillingError extends Error {}

/** The organization's Stripe customer, created on first use. */
export async function ensureCustomer(organizationId: string, email: string): Promise<string> {
  await ensureAccount(organizationId);
  const account = await getAccount(organizationId);
  if (account?.stripeCustomerId) return account.stripeCustomerId;
  const organization = await db.selectFrom("organization").select(["name"]).where("id", "=", organizationId).executeTakeFirstOrThrow();
  const customer = await stripe().customers.create(
    { name: organization.name, email, metadata: { organizationId } },
    { idempotencyKey: `customer-${organizationId}` },
  );
  await db.updateTable("llmAccount").set({ stripeCustomerId: customer.id })
    .where("organizationId", "=", organizationId).where("stripeCustomerId", "is", null).execute();
  return (await getAccount(organizationId))!.stripeCustomerId!;
}

function returnUrls(slug: string) {
  const base = `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard/organizations/${encodeURIComponent(slug)}/billing`;
  return { success_url: `${base}?checkout=success`, cancel_url: `${base}?checkout=cancelled` };
}

export function validCreditAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_CREDIT_USD || value > MAX_CREDIT_USD) {
    throw new BillingError(`Choose a whole number of dollars between ${MIN_CREDIT_USD} and ${MAX_CREDIT_USD}.`);
  }
  return value;
}

export async function createCreditCheckout(input: { organizationId: string; slug: string; userId: string; email: string; amountUsd: number }) {
  const customer = await ensureCustomer(input.organizationId, input.email);
  const metadata = {
    organizationId: input.organizationId,
    kind: "credits",
    creditMicros: String(input.amountUsd * 1_000_000),
    userId: input.userId,
  };
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: input.organizationId,
    line_items: [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: input.amountUsd * 100, product_data: { name: `Subtubes AI credits ($${input.amountUsd})` } },
    }],
    metadata,
    payment_intent_data: { metadata },
    ...returnUrls(input.slug),
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createSubscriptionCheckout(input: { organizationId: string; slug: string; userId: string; email: string; planId: string }) {
  const plan = findPlan(input.planId);
  if (!plan?.stripePriceId) throw new BillingError("That plan is not available.");
  const account = await getAccount(input.organizationId);
  if (hasActiveSubscription(account)) throw new BillingError("This organization already has a subscription. Manage it from the billing portal.");
  const customer = await ensureCustomer(input.organizationId, input.email);
  const metadata = { organizationId: input.organizationId, kind: "subscription", planId: plan.id, userId: input.userId };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.organizationId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    metadata,
    subscription_data: { metadata: { organizationId: input.organizationId, planId: plan.id } },
    ...returnUrls(input.slug),
  }, {
    // Repeated clicks within half an hour reuse one checkout instead of opening several that could each start a subscription.
    idempotencyKey: `checkout-subscription-${input.organizationId}-${input.userId}-${plan.id}-${Math.floor(Date.now() / 1_800_000)}`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalSession(input: { organizationId: string; slug: string }) {
  const account = await getAccount(input.organizationId);
  if (!account?.stripeCustomerId) throw new BillingError("There is nothing to manage yet. Subscribe or buy credits first.");
  const session = await stripe().billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: returnUrls(input.slug).success_url.replace("?checkout=success", ""),
  });
  return session.url;
}

// Webhooks. Each event is handled once: its id is recorded in the same transaction as its effect, and a redelivery finds it there.
// Stripe does not deliver events in order, so a subscription event only says which subscription changed: its current state is read
// from Stripe, and an old event delivered late cannot undo a newer change.
export async function handleStripeEvent(event: Stripe.Event): Promise<"handled" | "duplicate" | "ignored"> {
  const subscription = event.type.startsWith("customer.subscription.")
    ? await stripe().subscriptions.retrieve((event.data.object as Stripe.Subscription).id)
    : null;
  return db.transaction().execute(async (trx) => {
    const inserted = await trx.insertInto("stripeEvent").values({ id: event.id, type: event.type })
      .onConflict((oc) => oc.column("id").doNothing()).returning("id").executeTakeFirst();
    if (!inserted) return "duplicate";

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return (await applyCheckout(trx, event.data.object)) ? "handled" : "ignored";
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return (await applySubscription(trx, subscription!)) ? "handled" : "ignored";
      default:
        return "ignored";
    }
  });
}

async function applyCheckout(trx: Trx, session: Stripe.Checkout.Session): Promise<boolean> {
  const metadata = session.metadata ?? {};
  if (metadata.kind !== "credits" || session.payment_status !== "paid" || !metadata.organizationId) return false;
  const creditMicros = Number(metadata.creditMicros);
  if (!Number.isInteger(creditMicros) || creditMicros <= 0) return false;
  // The amount comes from our own metadata; it must match what was actually paid.
  if (session.amount_total !== null && session.amount_total * 10_000 < creditMicros) return false;

  const organization = await trx.selectFrom("organization").select("id").where("id", "=", metadata.organizationId).executeTakeFirst();
  if (!organization) return false;
  const credited = await trx.insertInto("llmCreditTransaction").values({
    id: `crd_${randomUUID().replace(/-/g, "")}`,
    organizationId: organization.id,
    amountMicros: creditMicros,
    kind: "purchase",
    description: `Credits purchased ($${creditMicros / 1_000_000})`,
    stripeCheckoutSessionId: session.id,
    createdBy: metadata.userId && await userExists(trx, metadata.userId) ? metadata.userId : null,
  }).onConflict((oc) => oc.column("stripeCheckoutSessionId").doNothing()).returning("id").executeTakeFirst();
  if (!credited) return false;

  await trx.insertInto("llmAccount").values({ organizationId: organization.id })
    .onConflict((oc) => oc.column("organizationId").doNothing()).execute();
  await trx.updateTable("llmAccount").set({ creditMicros: sql`"creditMicros" + ${creditMicros}`, updatedAt: new Date() })
    .where("organizationId", "=", organization.id).execute();
  return true;
}

async function userExists(trx: Trx, id: string) {
  return Boolean(await trx.selectFrom("user").select("id").where("id", "=", id).executeTakeFirst());
}

async function applySubscription(trx: Trx, subscription: Stripe.Subscription): Promise<boolean> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const byMetadata = subscription.metadata?.organizationId;
  const account = byMetadata
    ? await trx.selectFrom("llmAccount").selectAll().where("organizationId", "=", byMetadata).forUpdate().executeTakeFirst()
    : await trx.selectFrom("llmAccount").selectAll().where("stripeCustomerId", "=", customerId).forUpdate().executeTakeFirst();
  if (!account) return false;
  // An event about an older subscription must not overwrite the current one.
  if (account.stripeSubscriptionId && account.stripeSubscriptionId !== subscription.id && hasActiveSubscription(account)) {
    if (["active", "trialing", "past_due"].includes(subscription.status)) {
      // Two checkouts completed: the customer pays for a subscription that gives nothing. Needs a cancel and refund in Stripe.
      console.error("Duplicate Stripe subscription; cancel and refund it in Stripe", account.organizationId, subscription.id);
    }
    return false;
  }

  const item = subscription.items?.data?.[0];
  const plan = findPlan(subscription.metadata?.planId ?? "") ?? (item?.price?.id ? findPlanByPrice(item.price.id) : undefined);
  const ended = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  await trx.updateTable("llmAccount").set(ended
    ? {
      planId: "free", planStatus: "canceled", subscriptionAllowanceMicros: 0, stripeSubscriptionId: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false, stripeCustomerId: account.stripeCustomerId ?? customerId, updatedAt: new Date(),
    }
    : {
      planId: plan?.id ?? account.planId,
      planStatus: subscription.status,
      subscriptionAllowanceMicros: plan?.allowanceMicros ?? Number(account.subscriptionAllowanceMicros),
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: account.stripeCustomerId ?? customerId,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      updatedAt: new Date(),
    }).where("organizationId", "=", account.organizationId).execute();
  return true;
}
