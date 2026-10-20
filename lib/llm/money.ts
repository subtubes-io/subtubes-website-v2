import type { LlmModel } from "./models";

export const MICROS_PER_USD = 1_000_000;

export const usdToMicros = (usd: number) => Math.round(usd * MICROS_PER_USD);
export const microsToUsd = (micros: number) => micros / MICROS_PER_USD;

/** A reported USD cost in micro-dollars, rounded up, without float noise turning 0.000123 into 124. */
export const costUsdToMicros = (usd: number) => Math.max(0, Math.ceil(Math.round(usd * MICROS_PER_USD * 1_000) / 1_000));

export function formatUsd(micros: number, { precise = false }: { precise?: boolean } = {}): string {
  const usd = microsToUsd(micros);
  const digits = precise || (usd !== 0 && Math.abs(usd) < 0.01) ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: digits })
    .format(usd);
}

/** The calendar month (UTC) budgets are counted in, as `YYYY-MM`. */
export function periodOf(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first instant of the next period. */
export function periodResetsAt(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1));
}

export function previousPeriods(count: number, from = new Date()): string[] {
  const periods: string[] = [];
  for (let i = 0; i < count; i++) {
    periods.push(periodOf(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1))));
  }
  return periods;
}

const perToken = (usdPerMillion: number) => usdPerMillion; // micro-dollars per token == USD per million tokens

/** Cost in micro-dollars from token counts at catalog prices, rounded up. Cached input tokens are part of the input tokens. */
export function costFromTokens(
  model: LlmModel,
  tokens: { inputTokens: number; cachedInputTokens?: number; outputTokens: number },
): number {
  const cached = Math.min(tokens.cachedInputTokens ?? 0, tokens.inputTokens);
  const uncached = tokens.inputTokens - cached;
  const micros = uncached * perToken(model.pricing.input) + cached * perToken(model.pricing.cachedInput)
    + tokens.outputTokens * perToken(model.pricing.output);
  return Math.ceil(Math.round(micros * 1_000) / 1_000);
}

/** What an organization is charged for an upstream cost. Never less than the upstream cost's rounding, never negative. */
export function chargeFor(upstreamCostMicros: number, multiplier: number): number {
  return Math.max(0, Math.ceil(upstreamCostMicros * multiplier));
}

/**
 * A pessimistic token count for a request body, without a tokenizer: about one token per 3 bytes of the messages and tools JSON (real
 * text is closer to 4), and 5,000 tokens per image, above what the catalog's providers count for one image after their own resizing.
 * If a request still costs more than its reservation, the real cost is charged and the debt blocks further requests until paid.
 */
const IMAGE_TOKENS = 5_000;

export function estimateInputTokens(body: { messages?: unknown; tools?: unknown }): number {
  const text = JSON.stringify(body.messages ?? []) + JSON.stringify(body.tools ?? []);
  const images = (text.match(/"type":"image_url"/g) ?? []).length;
  const imageData = [...text.matchAll(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g)].reduce((sum, m) => sum + m[0].length, 0);
  return Math.ceil((Buffer.byteLength(text) - imageData) / 3) + images * IMAGE_TOKENS;
}

/** The most a request can cost: every input token uncached, and the full output budget used. */
export function worstCaseMicros(model: LlmModel, inputTokens: number, maxOutputTokens: number, multiplier: number): number {
  return chargeFor(costFromTokens(model, { inputTokens, outputTokens: maxOutputTokens }), multiplier);
}
