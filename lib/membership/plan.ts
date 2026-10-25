// The membership: $12 a month or $99 a year. Checkout creates the price inline, so nothing has to be set up in the Stripe dashboard
// beyond the API keys and the webhook.

export type MembershipInterval = "month" | "year";

export const MEMBERSHIP_PRICES_USD: Record<MembershipInterval, number> = { month: 12, year: 99 };

export const isMembershipInterval = (value: unknown): value is MembershipInterval => value === "month" || value === "year";

export const membershipPriceData = (interval: MembershipInterval) => ({
  currency: "usd",
  unit_amount: MEMBERSHIP_PRICES_USD[interval] * 100,
  recurring: { interval },
  product_data: { name: "Subtubes membership" },
});

/** Dollars saved by paying yearly instead of twelve months. */
export const ANNUAL_SAVINGS_USD = MEMBERSHIP_PRICES_USD.month * 12 - MEMBERSHIP_PRICES_USD.year;

// past_due keeps access while Stripe retries the card; every other status ends it.
const ACCESS_STATUSES = ["active", "trialing", "past_due"];

export const hasMembership = (status: string | null | undefined) => status !== null && status !== undefined && ACCESS_STATUSES.includes(status);
