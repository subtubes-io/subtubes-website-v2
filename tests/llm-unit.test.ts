import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeFor, costFromTokens, estimateInputTokens, periodOf, periodResetsAt, previousPeriods, worstCaseMicros } from "../lib/llm/money";
import { buildUpstreamBody, maxOutputTokens, parseChatRequest, resolveModel, StreamObserver, usageOutcome } from "../lib/llm/proxy";
import { DEFAULT_ENABLED_MODELS, enabledModelIds, findModel, type LlmModel } from "../lib/llm/models";
import { LlmError } from "../lib/llm/errors";

const model: LlmModel = {
  id: "test/model", upstreamId: "test/model", label: "Test", provider: "Test", contextLength: 100_000, maxOutputTokens: 8_000,
  defaultMaxOutputTokens: 4_000, supportsTools: true, supportsImages: true, pricing: { input: 2, cachedInput: 0.5, output: 10 },
  enabledByDefault: true,
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("cost from tokens charges cached input at the cached price, rounded up", () => {
  assert.equal(costFromTokens(model, { inputTokens: 1_000_000, outputTokens: 0 }), 2_000_000);
  assert.equal(costFromTokens(model, { inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 100 }), 600 * 2 + 400 * 0.5 + 100 * 10);
  // More cached tokens than input tokens cannot make the cost negative.
  assert.equal(costFromTokens(model, { inputTokens: 10, cachedInputTokens: 50, outputTokens: 0 }), 5);
  assert.equal(costFromTokens({ ...model, pricing: { input: 0.15, cachedInput: 0, output: 0 } }, { inputTokens: 1, outputTokens: 0 }), 1);
});

test("charges apply the multiplier and never go below zero", () => {
  assert.equal(chargeFor(1_000, 1), 1_000);
  assert.equal(chargeFor(1_001, 1.5), 1_502);
  assert.equal(chargeFor(-5, 2), 0);
  assert.equal(worstCaseMicros(model, 1_000, 4_000, 1), 1_000 * 2 + 4_000 * 10);
});

test("periods are UTC calendar months", () => {
  assert.equal(periodOf(new Date("2026-12-31T23:59:59Z")), "2026-12");
  assert.equal(periodResetsAt("2026-12").toISOString(), "2027-01-01T00:00:00.000Z");
  assert.deepEqual(previousPeriods(3, new Date("2026-02-15T00:00:00Z")), ["2026-02", "2026-01", "2025-12"]);
});

test("input estimates are pessimistic and count images", () => {
  const text = "hello world ".repeat(100);
  const tokens = estimateInputTokens({ messages: [{ role: "user", content: text }] });
  assert.ok(tokens >= text.length / 4, "the estimate should not be below a real tokenizer's count");
  const image = estimateInputTokens({
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(300_000)}` } }] }],
  });
  assert.ok(image >= 5_000 && image < 5_500, "base64 image data counts as one image, not as text");
});

test("requests are validated and only known fields are forwarded", () => {
  assert.throws(() => parseChatRequest(new TextEncoder().encode("{")), (e: unknown) => e instanceof LlmError && e.code === "invalid_request");
  assert.throws(() => parseChatRequest(encode({ model: "x", messages: [] })), (e: unknown) => e instanceof LlmError && e.code === "invalid_request");
  const request = parseChatRequest(encode({
    model: "test/model", messages: [{ role: "user", content: "hi" }], temperature: 0.2, stream: true, max_tokens: 50_000,
    provider: { order: ["anything"] }, models: ["other/model"], transforms: ["x"], user: "spoofed", plugins: [{ id: "web" }],
  }));
  const maxTokens = maxOutputTokens(request, model);
  assert.equal(maxTokens, 8_000, "max_tokens is capped at the model's limit");
  const body = buildUpstreamBody(request, model, maxTokens, "user-1");
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "provider", "stream", "stream_options", "temperature", "usage", "user"]);
  assert.deepEqual(body.provider, { data_collection: "deny" });
  assert.notEqual(body.user, "spoofed");
  assert.notEqual(body.user, "user-1");
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(maxOutputTokens(parseChatRequest(encode({ model: "m", messages: [{ role: "user" }] })), model), 4_000);
});

test("models must be in the catalog and enabled", () => {
  const first = DEFAULT_ENABLED_MODELS[0];
  assert.equal(resolveModel(first, DEFAULT_ENABLED_MODELS).id, first);
  assert.throws(() => resolveModel("nope/nope", DEFAULT_ENABLED_MODELS), (e: unknown) => e instanceof LlmError && e.code === "model_not_found");
  assert.throws(() => resolveModel(first, []), (e: unknown) => e instanceof LlmError && e.code === "model_not_enabled");
  assert.deepEqual(enabledModelIds(null), [...DEFAULT_ENABLED_MODELS]);
  assert.deepEqual(enabledModelIds([first, "removed/model"]), [first], "models dropped from the catalog are not enabled");
  assert.ok(findModel(first));
});

test("the reported cost is used, catalog prices only when it is missing", () => {
  assert.equal(usageOutcome(model, { prompt_tokens: 100, completion_tokens: 10, cost: 0.0012345 }).upstreamCostMicros, 1_235);
  assert.equal(usageOutcome(model, { prompt_tokens: 9, completion_tokens: 3, cost: 0.000123 }).upstreamCostMicros, 123, "no float noise");
  assert.equal(usageOutcome(model, { prompt_tokens: 9, completion_tokens: 3, cost: 0.0000001 }).upstreamCostMicros, 1, "fractions round up");
  const fallback = usageOutcome(model, { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } });
  assert.equal(fallback.upstreamCostMicros, 60 * 2 + 40 * 0.5 + 10 * 10);
  assert.equal(fallback.cachedInputTokens, 40);
});

test("the stream observer finds the id, usage and streamed text across chunk boundaries", () => {
  const observer = new StreamObserver();
  const sse = [
    `: OPENROUTER PROCESSING\n\n`,
    `data: ${JSON.stringify({ id: "gen-1", choices: [{ delta: { content: "Hello" } }] })}\n\n`,
    `data: ${JSON.stringify({ id: "gen-1", choices: [{ delta: { tool_calls: [{ function: { name: "f", arguments: "{}" } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ id: "gen-1", choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0001 } })}\n\n`,
    `data: [DONE]\n\n`,
  ].join("");
  const bytes = new TextEncoder().encode(sse);
  for (let i = 0; i < bytes.length; i += 7) observer.push(bytes.subarray(i, i + 7));
  observer.end();
  assert.equal(observer.generationId, "gen-1");
  assert.equal(observer.streamedChars, 5 + 1 + 2);
  assert.equal(observer.usage?.prompt_tokens, 12);
  assert.equal(observer.sawError, false);
});

test("the service is off unless both the switch and the OpenRouter key are set", async () => {
  const { llmConfig } = await import("../lib/llm/config");
  const saved = { enabled: process.env.LLM_ENABLED, key: process.env.OPENROUTER_API_KEY };
  try {
    process.env.LLM_ENABLED = "true";
    process.env.OPENROUTER_API_KEY = "";
    assert.equal(llmConfig.enabled(), false);
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    assert.equal(llmConfig.enabled(), true);
    process.env.LLM_ENABLED = "1";
    assert.equal(llmConfig.enabled(), false, "only the exact value true turns it on");
  } finally {
    for (const [name, value] of [["LLM_ENABLED", saved.enabled], ["OPENROUTER_API_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
