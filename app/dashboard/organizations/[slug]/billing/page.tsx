import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { BillingPanel } from "@/components/billing-panel";
import { billingConfigured, CREDIT_PRESETS_USD, findPlan, MAX_CREDIT_USD, MIN_CREDIT_USD, plans } from "@/lib/billing/stripe";
import { allowanceMicros, getAccount, hasActiveSubscription } from "@/lib/llm/account";
import { creditTransactions, organizationForPage } from "@/lib/llm/dashboard";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ checkout?: string | string[] }> };

async function BillingDetails({ params, searchParams }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}/billing`)}`);
  const organization = await organizationForPage(slug, session.user.id);
  if (!organization) notFound();
  const [account, transactions, query] = await Promise.all([
    getAccount(organization.id),
    organization.canManage ? creditTransactions(organization.id) : Promise.resolve([]),
    searchParams,
  ]);
  const subscribed = hasActiveSubscription(account);
  const checkout = query.checkout === "success" || query.checkout === "cancelled" ? query.checkout : null;

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Billing</h1>
        </div>
      </header>
      <BillingPanel config={{
        organizationId: organization.id,
        canManage: organization.canManage,
        configured: billingConfigured(),
        checkout,
        plan: {
          id: subscribed ? account!.planId : "free",
          label: subscribed ? findPlan(account!.planId)?.label ?? account!.planId : "Free",
          status: account?.planStatus ?? null,
          subscribed,
          allowanceMicros: allowanceMicros(account),
          currentPeriodEnd: account?.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
          hasCustomer: Boolean(account?.stripeCustomerId),
        },
        plans: plans().map((plan) => ({
          id: plan.id, label: plan.label, priceUsdPerMonth: plan.priceUsdPerMonth, allowanceMicros: plan.allowanceMicros,
          available: Boolean(plan.stripePriceId),
        })),
        creditMicros: Number(account?.creditMicros ?? 0),
        creditPresetsUsd: CREDIT_PRESETS_USD,
        minCreditUsd: MIN_CREDIT_USD,
        maxCreditUsd: MAX_CREDIT_USD,
        transactions,
      }} />
    </>
  );
}

export default function BillingPage(props: Props) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading billing...</p>}>
      <BillingDetails {...props} />
    </Suspense>
  );
}
