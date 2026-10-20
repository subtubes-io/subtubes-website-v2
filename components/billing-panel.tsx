"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Table } from "@/components/ui/table";
import { formatUsd, sendJson } from "@/components/ai-client-utils";

type Transaction = { id: string; amountMicros: number; kind: string; description: string; createdAt: string };

export type BillingPanelConfig = {
  organizationId: string;
  canManage: boolean;
  configured: boolean;
  checkout: "success" | "cancelled" | null;
  plan: {
    id: string;
    label: string;
    status: string | null;
    subscribed: boolean;
    allowanceMicros: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
  };
  plans: { id: string; label: string; priceUsdPerMonth: number; allowanceMicros: number; available: boolean }[];
  creditMicros: number;
  creditPresetsUsd: readonly number[];
  minCreditUsd: number;
  maxCreditUsd: number;
  transactions: Transaction[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function BillingPanel({ config }: { config: BillingPanelConfig }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(String(config.creditPresetsUsd[1] ?? 25));
  const base = `/api/organizations/${encodeURIComponent(config.organizationId)}/billing`;

  async function redirectTo(id: string, url: string, body?: unknown) {
    setPending(id);
    setError("");
    try {
      const result = await sendJson<{ url: string }>(url, "POST", body ?? {});
      if (!result?.url) throw new Error("Stripe did not return a page to continue on.");
      window.location.assign(result.url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed. Please try again.");
      setPending(null);
    }
  }

  const { plan } = config;
  const statusText = plan.subscribed
    ? plan.status === "past_due"
      ? "Payment failed. Stripe is retrying; update the card in the billing portal to keep the allowance."
      : plan.cancelAtPeriodEnd && plan.currentPeriodEnd
        ? `Cancels on ${dateFormatter.format(new Date(plan.currentPeriodEnd))}.`
        : plan.currentPeriodEnd ? `Renews on ${dateFormatter.format(new Date(plan.currentPeriodEnd))}.` : "Active."
    : "Free plan.";

  return (
    <>
      {config.checkout === "success" && (
        <p className="dashboard-empty" role="status">Thank you. The payment is being confirmed; credits and plan changes appear here within a minute.</p>
      )}
      {config.checkout === "cancelled" && <p className="dashboard-empty" role="status">Checkout was cancelled. Nothing was charged.</p>}
      {!config.configured && <p className="notice" role="status">Payments are not set up on this website yet.</p>}
      {error && <FormError>{error}</FormError>}

      <section className="dashboard-section" aria-labelledby="billing-plan">
        <h2 id="billing-plan" className="dashboard-section-title">Plan</h2>
        <dl className="ai-stats">
          <div className="ai-stat"><dt>Current plan</dt><dd><span className="ai-stat-value">{plan.label}</span><span className="ai-stat-hint">{statusText}</span></dd></div>
          <div className="ai-stat"><dt>Monthly AI allowance</dt><dd><span className="ai-stat-value">{formatUsd(plan.allowanceMicros)}</span></dd></div>
          <div className="ai-stat"><dt>Prepaid credits</dt><dd><span className="ai-stat-value">{formatUsd(config.creditMicros)}</span><span className="ai-stat-hint">Used after the allowance; never expire</span></dd></div>
        </dl>
        {config.canManage && config.configured && (
          <div className="organization-form">
            {!plan.subscribed && config.plans.filter((p) => p.available).map((p) => (
              <Button key={p.id} disabled={pending !== null} onClick={() => void redirectTo(`plan-${p.id}`, `${base}/checkout`, { kind: "subscription", planId: p.id })}>
                {pending === `plan-${p.id}` ? "Opening Stripe..." : `Subscribe to ${p.label}: $${p.priceUsdPerMonth}/month, ${formatUsd(p.allowanceMicros)} of AI included`}
              </Button>
            ))}
            {plan.hasCustomer && (
              <Button variant="secondary" disabled={pending !== null} onClick={() => void redirectTo("portal", `${base}/portal`)}>
                {pending === "portal" ? "Opening Stripe..." : "Manage billing"}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="billing-credits">
        <h2 id="billing-credits" className="dashboard-section-title">Buy credits</h2>
        <p className="dashboard-empty">
          Credits pay for AI use once the month&apos;s plan allowance is used. The organization budget and member limits still apply.
        </p>
        {config.canManage && config.configured ? (
          <form className="organization-form" onSubmit={(event) => {
            event.preventDefault();
            const value = Number(amount);
            if (!Number.isInteger(value) || value < config.minCreditUsd || value > config.maxCreditUsd) {
              setError(`Choose a whole number of dollars between ${config.minCreditUsd} and ${config.maxCreditUsd}.`);
              return;
            }
            void redirectTo("credits", `${base}/checkout`, { kind: "credits", amountUsd: value });
          }}>
            <label>
              <span className="sr-only">Amount in US dollars</span>
              <select className="site-input" value={config.creditPresetsUsd.includes(Number(amount)) ? amount : "custom"} aria-label="Credit amount"
                onChange={(event) => { if (event.target.value !== "custom") setAmount(event.target.value); }}>
                {config.creditPresetsUsd.map((usd) => <option key={usd} value={String(usd)}>${usd}</option>)}
                <option value="custom">Other amount</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Other amount in US dollars</span>
              <Input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount in US dollars" />
            </label>
            <Button type="submit" disabled={pending !== null}>{pending === "credits" ? "Opening Stripe..." : "Buy credits"}</Button>
          </form>
        ) : !config.canManage ? (
          <p className="dashboard-empty">Only owners and admins can buy credits or change the plan.</p>
        ) : null}
        <Table<Transaction> config={{
          caption: "Credit history",
          columns: [
            { id: "date", header: "Date (UTC)", cell: (row) => dateFormatter.format(new Date(row.createdAt)) },
            { id: "description", header: "Description", cell: (row) => row.description },
            { id: "amount", header: "Amount", align: "right", cell: (row) => formatUsd(row.amountMicros) },
          ],
          rows: config.transactions,
          rowKey: (row) => row.id,
          emptyMessage: "No credits bought yet.",
        }} />
      </section>
    </>
  );
}
