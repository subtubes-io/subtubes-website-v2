// Server-only settings of the AI service, read on every use so tests and Vercel env changes apply without code changes.

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);

export const llmConfig = {
  /** Global kill switch. The service is off unless LLM_ENABLED is "true". */
  enabled: () => process.env.LLM_ENABLED === "true" && Boolean(process.env.OPENROUTER_API_KEY),
  openRouterBaseUrl: () => (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  openRouterApiKey: () => process.env.OPENROUTER_API_KEY ?? "",
  siteUrl: () => process.env.BETTER_AUTH_URL || "https://subtubes.com",
  /** Applied to OpenRouter's cost to get what an organization is charged: 2 means they pay twice what we pay. */
  priceMultiplier: () => number("LLM_PRICE_MULTIPLIER", 2),
  /** Only providers that keep no prompts or completions (zero data retention). On unless LLM_REQUIRE_ZDR is "false". */
  requireZdr: () => process.env.LLM_REQUIRE_ZDR !== "false",
  /** All organizations together may not spend more than this per month (OpenRouter cost). 0 = no ceiling. */
  globalMonthlyCeilingMicros: () => usdToMicros(number("LLM_GLOBAL_MONTHLY_CEILING_USD", 0)),
  /** Allowance every organization without a subscription gets per month, unless overridden on its account. */
  freeMonthlyAllowanceMicros: () => usdToMicros(number("LLM_FREE_MONTHLY_ALLOWANCE_USD", 0)),
  /** Largest request body accepted by the proxy. */
  maxBodyBytes: () => number("LLM_MAX_BODY_BYTES", 8 * 1024 * 1024),
};
