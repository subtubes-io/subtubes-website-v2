import Stripe from "stripe";

// Payments: a monthly subscription that includes an AI allowance, and one-time purchases of prepaid credits. Prices of subscriptions live
// in Stripe (STRIPE_PRICE_*); what a plan includes lives here.

export interface Plan {
  id: string;
  label: string;
  /** Shown on the billing page; the amount charged is the Stripe price's. */
  priceUsdPerMonth: number;
  allowanceMicros: number;
  stripePriceId: string | undefined;
}

const usdEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export function plans(): Plan[] {
  return [
    {
      id: "pro",
      label: "Pro",
      priceUsdPerMonth: usdEnv("LLM_PRO_PRICE_USD", 39),
      allowanceMicros: Math.round(usdEnv("LLM_PRO_ALLOWANCE_USD", 20) * 1_000_000),
      stripePriceId: process.env.STRIPE_PRICE_PRO,
    },
  ];
}

export const findPlan = (id: string) => plans().find((plan) => plan.id === id);
export const findPlanByPrice = (priceId: string) => plans().find((plan) => plan.stripePriceId === priceId);

export const CREDIT_PRESETS_USD = [10, 25, 50, 100] as const;
export const MIN_CREDIT_USD = 5;
export const MAX_CREDIT_USD = 1000;

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

let client: Stripe | undefined;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) {
    // STRIPE_API_BASE points the client at a fake Stripe in tests.
    const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
    client = new Stripe(key, base
      ? { host: base.hostname, port: base.port || (base.protocol === "https:" ? 443 : 80), protocol: base.protocol.replace(":", "") as "http" | "https" }
      : {});
  }
  return client;
}
