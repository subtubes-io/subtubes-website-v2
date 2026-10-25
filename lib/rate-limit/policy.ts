import type { RateLimitRule } from "./index";

function fromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// Every limit in one place, so numbers change without touching routes.
export const RATE_LIMITS = {
  /** LLM proxy calls per person per minute (all endpoints under /api/llm/v1). */
  llmRequests: (): RateLimitRule => ({ limit: fromEnv("LLM_RATE_LIMIT_PER_MINUTE", 60), windowSeconds: 60 }),
  /** Requests with an unknown or revoked key per IP, checked before the key lookup. */
  llmAuthFailures: (): RateLimitRule => ({ limit: fromEnv("LLM_AUTH_FAILURES_PER_10_MINUTES", 20), windowSeconds: 600 }),
  /** Key creation per person per hour. */
  llmKeyCreation: (): RateLimitRule => ({ limit: 20, windowSeconds: 3600 }),
  /** Checkout and portal sessions per person per hour. */
  billingSessions: (): RateLimitRule => ({ limit: 30, windowSeconds: 3600 }),
  /** Contact form messages per IP per hour. */
  contactMessages: (): RateLimitRule => ({ limit: 5, windowSeconds: 3600 }),
  /** Newsletter signups per IP per hour. */
  newsletterSignup: (): RateLimitRule => ({ limit: 10, windowSeconds: 3600 }),
} as const;

/** Completions one person may have in flight at once. */
export const llmMaxInFlight = () => fromEnv("LLM_MAX_IN_FLIGHT", 4);
