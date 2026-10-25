// The membership: one plan, $10 a month, no annual option. Checkout creates the price inline, so nothing has to be set up in the
// Stripe dashboard beyond the API keys and the webhook.

export const MEMBERSHIP_PRICE_USD = 10;

export const MEMBERSHIP_PRICE_DATA = {
  currency: "usd",
  unit_amount: MEMBERSHIP_PRICE_USD * 100,
  recurring: { interval: "month" as const },
  product_data: { name: "Subtubes membership" },
};

// past_due keeps access while Stripe retries the card; every other status ends it.
const ACCESS_STATUSES = ["active", "trialing", "past_due"];

export const hasMembership = (status: string | null | undefined) => status !== null && status !== undefined && ACCESS_STATUSES.includes(status);
