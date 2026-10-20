import { db } from "@/lib/db/client";
import { llmConfig } from "./config";
import { settle } from "./ledger";
import { findModel } from "./models";
import { costFromTokens, costUsdToMicros } from "./money";

// Requests whose cost was not known when they ended: streams the client stopped, broken streams, and reservations left behind by a
// function that died. The real cost comes from OpenRouter's generation endpoint; when it cannot be found, what was sent and streamed is
// charged at catalog prices, never zero.

const ABORTED_GRACE_MS = 60_000;
const STALE_RESERVED_MS = 15 * 60_000;
const GIVE_UP_LOOKUP_MS = 60 * 60_000;

interface GenerationStats {
  total_cost?: number;
  tokens_prompt?: number;
  tokens_completion?: number;
  native_tokens_cached?: number;
  native_tokens_reasoning?: number;
}

async function fetchGeneration(id: string): Promise<GenerationStats | null> {
  try {
    const response = await fetch(`${llmConfig.openRouterBaseUrl()}/generation?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${llmConfig.openRouterApiKey()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { data?: GenerationStats };
    return body.data && typeof body.data.total_cost === "number" ? body.data : null;
  } catch {
    return null;
  }
}

export async function reconcile(now = new Date()): Promise<{ examined: number; settled: number; estimated: number }> {
  const rows = await db
    .selectFrom("llmUsage")
    .select(["id", "status", "model", "generationId", "estimatedInputTokens", "streamedChars", "estimateMicros", "createdAt"])
    .where((eb) => eb.or([
      eb.and([eb("status", "=", "aborted"), eb("createdAt", "<", new Date(now.getTime() - ABORTED_GRACE_MS))]),
      eb.and([eb("status", "=", "reserved"), eb("createdAt", "<", new Date(now.getTime() - STALE_RESERVED_MS))]),
    ]))
    .orderBy("createdAt")
    .limit(200)
    .execute();

  let settled = 0;
  let estimated = 0;
  for (const row of rows) {
    const generation = row.generationId ? await fetchGeneration(row.generationId) : null;
    if (generation) {
      const ok = await settle(row.id, {
        status: "settled",
        upstreamCostMicros: costUsdToMicros(generation.total_cost ?? 0),
        inputTokens: generation.tokens_prompt,
        outputTokens: generation.tokens_completion,
        cachedInputTokens: generation.native_tokens_cached,
        reasoningTokens: generation.native_tokens_reasoning,
      });
      if (ok) settled++;
      continue;
    }
    const age = now.getTime() - row.createdAt.getTime();
    if (row.generationId && age < GIVE_UP_LOOKUP_MS) continue;

    const model = findModel(row.model);
    const outputTokens = Math.ceil(row.streamedChars / 4);
    const upstreamCostMicros = model
      ? costFromTokens(model, { inputTokens: row.estimatedInputTokens, outputTokens })
      : Math.ceil(Number(row.estimateMicros) / Math.max(llmConfig.priceMultiplier(), 1e-9));
    const ok = await settle(row.id, { status: "settled", upstreamCostMicros, inputTokens: row.estimatedInputTokens, outputTokens });
    if (ok) estimated++;
  }
  return { examined: rows.length, settled, estimated };
}
