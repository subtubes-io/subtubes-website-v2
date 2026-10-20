import { createHash } from "node:crypto";
import { z } from "zod";
import { llmConfig } from "./config";
import { LlmError } from "./errors";
import { findModel, type LlmModel } from "./models";
import { costFromTokens, costUsdToMicros } from "./money";

// Turning an OpenAI-style chat completion request into the one sent to OpenRouter. Only the fields below are forwarded; everything else
// is dropped. `max_tokens` is always set (capped to the model's limit) so the worst case can be reserved.

const message = z.looseObject({ role: z.string().min(1).max(32) });
const tool = z.looseObject({ type: z.string() });

const requestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(message).min(1).max(5_000),
  tools: z.array(tool).max(256).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
  stream: z.boolean().optional(),
  stream_options: z.looseObject({ include_usage: z.boolean().optional() }).optional(),
  response_format: z.looseObject({ type: z.string() }).optional(),
  seed: z.number().int().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  reasoning: z.looseObject({}).optional(),
  reasoning_effort: z.string().max(16).optional(),
});

export type ChatRequest = z.infer<typeof requestSchema>;

const FORWARDED = [
  "messages", "tools", "tool_choice", "parallel_tool_calls", "temperature", "top_p", "stop", "response_format", "seed",
  "presence_penalty", "frequency_penalty", "reasoning", "reasoning_effort",
] as const;

export function parseChatRequest(raw: Uint8Array): ChatRequest {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw new LlmError("invalid_request", "The request body is not valid JSON.");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LlmError("invalid_request", `Invalid request: ${issue.path.map(String).join(".") || "body"}: ${issue.message}`, undefined,
      issue.path.map(String).join(".") || null);
  }
  return parsed.data;
}

export function resolveModel(id: string, enabled: readonly string[]): LlmModel {
  const model = findModel(id);
  if (!model) throw new LlmError("model_not_found", `The model \`${id}\` is not offered. See GET /api/llm/v1/models.`, undefined, "model");
  if (!enabled.includes(model.id)) {
    throw new LlmError("model_not_enabled", `Your organization has not enabled \`${id}\`. An admin can enable it on the AI page.`,
      { enabledModels: [...enabled] }, "model");
  }
  return model;
}

export function maxOutputTokens(request: ChatRequest, model: LlmModel): number {
  const asked = request.max_completion_tokens ?? request.max_tokens ?? model.defaultMaxOutputTokens;
  return Math.min(asked, model.maxOutputTokens);
}

/** The OpenRouter user id: stable per person, but not their id. */
export const upstreamUser = (userId: string) => createHash("sha256").update(`subtubes:${userId}`).digest("hex").slice(0, 32);

export function buildUpstreamBody(request: ChatRequest, model: LlmModel, maxTokens: number, userId: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model: model.upstreamId };
  for (const field of FORWARDED) if (request[field] !== undefined) body[field] = request[field];
  body.max_tokens = maxTokens;
  body.stream = request.stream === true;
  if (body.stream) body.stream_options = { include_usage: true };
  body.usage = { include: true };
  // People's code and designs pass through: providers that train on or keep prompts are never used.
  body.provider = { data_collection: "deny", ...(process.env.LLM_REQUIRE_ZDR === "true" ? { zdr: true } : {}) };
  body.user = upstreamUser(userId);
  return body;
}

export function callUpstream(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(`${llmConfig.openRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llmConfig.openRouterApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": llmConfig.siteUrl(),
      "X-Title": "Subtubes",
    },
    body: JSON.stringify(body),
    signal,
  });
}

export interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

/** Tokens and cost from OpenRouter's usage object. The reported cost is used; catalog prices only when it is missing. */
export function usageOutcome(model: LlmModel, usage: UpstreamUsage) {
  const inputTokens = Math.max(0, Math.floor(usage.prompt_tokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(usage.completion_tokens ?? 0));
  const cachedInputTokens = Math.max(0, Math.floor(usage.prompt_tokens_details?.cached_tokens ?? 0));
  const reasoningTokens = Math.max(0, Math.floor(usage.completion_tokens_details?.reasoning_tokens ?? 0));
  const upstreamCostMicros = typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
    ? costUsdToMicros(usage.cost)
    : costFromTokens(model, { inputTokens, cachedInputTokens, outputTokens });
  return { inputTokens, outputTokens, cachedInputTokens, reasoningTokens, upstreamCostMicros };
}

/** Maps an OpenRouter error to what the caller sees. Our own OpenRouter account problems are never shown as the caller's. */
export async function upstreamError(response: Response): Promise<LlmError> {
  let message = "";
  try {
    const body = await response.json() as { error?: { message?: string } };
    message = typeof body?.error?.message === "string" ? body.error.message.slice(0, 500) : "";
  } catch {
    // An error without a JSON body keeps the generic message.
  }
  if (response.status === 400 || response.status === 422) {
    return new LlmError("invalid_request", message || "The model provider refused the request.");
  }
  if (response.status === 429) {
    return new LlmError("rate_limited", "The model provider is busy. Try again shortly.", { retryAfterSeconds: 5 });
  }
  if (response.status === 401 || response.status === 402 || response.status === 403) {
    console.error("OpenRouter refused our credentials or credit", response.status);
    return new LlmError("service_unavailable", "The AI service is temporarily unavailable. You were not charged.");
  }
  return new LlmError("upstream_error", "The model provider failed. You were not charged. Try again.");
}

/** Reads the SSE stream as it passes through, picking out the generation id, the final usage and how much text was streamed. */
export class StreamObserver {
  generationId: string | null = null;
  usage: UpstreamUsage | null = null;
  streamedChars = 0;
  sawError = false;
  private buffer = "";
  private decoder = new TextDecoder();

  push(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
    }
  }

  end() {
    this.buffer += this.decoder.decode();
    if (this.buffer.trim()) this.line(this.buffer.trim());
    this.buffer = "";
  }

  private line(line: string) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event: {
      id?: unknown;
      usage?: UpstreamUsage;
      error?: unknown;
      choices?: { delta?: { content?: unknown; reasoning?: unknown; tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] } }[];
    };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof event.id === "string" && !this.generationId) this.generationId = event.id;
    if (event.usage && typeof event.usage === "object") this.usage = event.usage;
    if (event.error) this.sawError = true;
    for (const choice of event.choices ?? []) {
      const delta = choice.delta;
      if (!delta) continue;
      if (typeof delta.content === "string") this.streamedChars += delta.content.length;
      if (typeof delta.reasoning === "string") this.streamedChars += delta.reasoning.length;
      for (const call of delta.tool_calls ?? []) {
        if (typeof call.function?.name === "string") this.streamedChars += call.function.name.length;
        if (typeof call.function?.arguments === "string") this.streamedChars += call.function.arguments.length;
      }
    }
  }
}
