// The curated catalog of models the service offers. Organizations choose which of these their members may use; anything not listed here
// is refused. Prices (USD per million tokens) are only used to estimate the worst case before a call; what is charged is the cost
// OpenRouter reports. Changing this list is a reviewed deploy. Only models that handle tool calls well are listed: the assistant is
// tool-driven.

export interface LlmModel {
  /** What clients send as `model`. */
  id: string;
  /** The OpenRouter model id. */
  upstreamId: string;
  label: string;
  provider: string;
  contextLength: number;
  /** Hard cap on `max_tokens`. */
  maxOutputTokens: number;
  /** Used when the request does not set `max_tokens`, so every reservation has a bound. */
  defaultMaxOutputTokens: number;
  supportsTools: boolean;
  supportsImages: boolean;
  /** USD per million tokens. */
  pricing: { input: number; cachedInput: number; output: number };
  /** Enabled for an organization that has not chosen its models yet. */
  enabledByDefault: boolean;
}

const model = (m: Omit<LlmModel, "id" | "supportsTools" | "defaultMaxOutputTokens"> & Partial<LlmModel>): LlmModel => ({
  id: m.upstreamId,
  supportsTools: true,
  defaultMaxOutputTokens: Math.min(16_384, m.maxOutputTokens),
  ...m,
});

export const LLM_MODELS: readonly LlmModel[] = [
  model({
    upstreamId: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "OpenAI", contextLength: 1_050_000, maxOutputTokens: 128_000,
    supportsImages: true, pricing: { input: 2, cachedInput: 0.1, output: 10 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "openai/gpt-6-luna", label: "GPT-6 Luna", provider: "OpenAI", contextLength: 1_050_000, maxOutputTokens: 128_000,
    supportsImages: true, pricing: { input: 0.1, cachedInput: 0.01, output: 0.5 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "Anthropic", contextLength: 1_000_000,
    maxOutputTokens: 128_000, supportsImages: true, pricing: { input: 2, cachedInput: 0.1, output: 10 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", provider: "Anthropic", contextLength: 1_000_000,
    maxOutputTokens: 128_000, supportsImages: true, pricing: { input: 0.1, cachedInput: 0.01, output: 0.5 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "Anthropic", contextLength: 1_000_000,
    maxOutputTokens: 128_000, supportsImages: true, pricing: { input: 4, cachedInput: 0.2, output: 20 }, enabledByDefault: false,
  }),
  model({
    upstreamId: "google/gemini-4-argon", label: "Gemini 4 Argon", provider: "Google", contextLength: 1_048_576, maxOutputTokens: 128_000,
    supportsImages: true, pricing: { input: 2, cachedInput: 0.1, output: 10 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "Google", contextLength: 1_048_576,
    maxOutputTokens: 65_536, supportsImages: true, pricing: { input: 0.825, cachedInput: 0.083, output: 4.125 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", provider: "DeepSeek", contextLength: 1_048_576,
    maxOutputTokens: 128_000, supportsImages: true, pricing: { input: 0.028, cachedInput: 0.001, output: 0.12 }, enabledByDefault: true,
  }),
  model({
    upstreamId: "x-ai/grok-4.7", label: "Grok 4.7", provider: "xAI", contextLength: 500_000, maxOutputTokens: 128_000,
    supportsImages: true, pricing: { input: 2, cachedInput: 0.5, output: 6 }, enabledByDefault: false,
  }),
];

const byId = new Map(LLM_MODELS.map((m) => [m.id, m]));

export function findModel(id: string): LlmModel | undefined {
  return byId.get(id);
}

export const DEFAULT_ENABLED_MODELS: readonly string[] = LLM_MODELS.filter((m) => m.enabledByDefault).map((m) => m.id);

/** The catalog models an organization allows; `null` means it has not chosen and gets the defaults. Retired ids are dropped. */
export function enabledModelIds(chosen: readonly string[] | null | undefined): string[] {
  const ids = chosen ?? DEFAULT_ENABLED_MODELS;
  return LLM_MODELS.filter((m) => ids.includes(m.id)).map((m) => m.id);
}
