import { after } from "next/server";
import { getAccount, getMemberLimit } from "@/lib/llm/account";
import { authenticateLlm } from "@/lib/llm/auth";
import { llmConfig } from "@/lib/llm/config";
import { handleLlm, LlmError, llmErrorResponse, NO_STORE } from "@/lib/llm/errors";
import { touchKey } from "@/lib/llm/keys";
import { markAborted, memberDisabled, reserve, settle } from "@/lib/llm/ledger";
import { enabledModelIds } from "@/lib/llm/models";
import { estimateInputTokens, worstCaseMicros } from "@/lib/llm/money";
import {
  buildUpstreamBody, callUpstream, maxOutputTokens, parseChatRequest, resolveModel, StreamObserver, upstreamError, usageOutcome,
  type UpstreamUsage,
} from "@/lib/llm/proxy";

// Long generations stream for minutes; settlement must still run after the client is gone.
export const maxDuration = 300;

// OpenAI-compatible chat completions, billed to the organization of the API key. See docs/llm-api.md for the order of checks.
export function POST(request: Request) {
  return handleLlm(async () => {
    if (!llmConfig.enabled()) throw new LlmError("service_unavailable", "The AI service is turned off right now.");
    const caller = await authenticateLlm(request);
    after(() => touchKey(caller));

    const [memberLimit, account] = await Promise.all([
      getMemberLimit(caller.organizationId, caller.userId),
      getAccount(caller.organizationId),
    ]);
    if (memberLimit?.disabled) throw memberDisabled();

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") throw new LlmError("unsupported_media_type", "Send the request as application/json.");
    const chat = parseChatRequest(await readBody(request, llmConfig.maxBodyBytes()));
    const model = resolveModel(chat.model, enabledModelIds(account?.enabledModels));

    const maxTokens = maxOutputTokens(chat, model);
    const inputTokens = estimateInputTokens(chat);
    if (inputTokens > model.contextLength * 1.5) {
      throw new LlmError("invalid_request", `The request is too long for ${model.label}.`, undefined, "messages");
    }
    const stream = chat.stream === true;
    const reservation = await reserve({
      organizationId: caller.organizationId,
      userId: caller.userId,
      apiKeyId: caller.keyId,
      model: model.id,
      upstreamModel: model.upstreamId,
      stream,
      estimateMicros: worstCaseMicros(model, inputTokens, maxTokens, llmConfig.priceMultiplier()),
      estimatedInputTokens: inputTokens,
    });

    const upstreamAbort = new AbortController();
    const onClientGone = () => upstreamAbort.abort();
    request.signal.addEventListener("abort", onClientGone, { once: true });

    let upstream: Response;
    try {
      upstream = await callUpstream(buildUpstreamBody(chat, model, maxTokens, caller.userId), upstreamAbort.signal);
    } catch {
      await settle(reservation.usageId, { status: "failed", upstreamCostMicros: 0 });
      throw new LlmError("upstream_error", "Could not reach the model provider. You were not charged. Try again.");
    }

    if (!upstream.ok) {
      const error = await upstreamError(upstream);
      await settle(reservation.usageId, { status: "failed", upstreamCostMicros: 0, upstreamStatus: upstream.status });
      return llmErrorResponse(error);
    }

    if (!stream) {
      let text: string;
      try {
        text = await upstream.text();
      } catch {
        await markAborted(reservation.usageId, { generationId: null, streamedChars: 0, upstreamStatus: upstream.status });
        throw new LlmError("upstream_error", "The model provider's reply was cut off.");
      }
      let parsed: { id?: unknown; usage?: UpstreamUsage } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        // An unreadable reply is passed on as is; its cost is reconciled later.
      }
      const generationId = typeof parsed.id === "string" ? parsed.id : null;
      if (parsed.usage) {
        await settle(reservation.usageId, {
          status: "settled", ...usageOutcome(model, parsed.usage), generationId, upstreamStatus: upstream.status,
        });
      } else {
        await markAborted(reservation.usageId, { generationId, streamedChars: text.length, upstreamStatus: upstream.status });
      }
      return new Response(text, {
        status: 200,
        headers: { ...NO_STORE, "Content-Type": "application/json", "X-Subtubes-Request-Id": reservation.usageId },
      });
    }

    const body = upstream.body;
    if (!body) {
      await markAborted(reservation.usageId, { generationId: null, streamedChars: 0, upstreamStatus: upstream.status });
      throw new LlmError("upstream_error", "The model provider sent no reply.");
    }

    const observer = new StreamObserver();
    const reader = body.getReader();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    let recorded = false;
    const record = async (completed: boolean) => {
      if (recorded) return;
      recorded = true;
      request.signal.removeEventListener("abort", onClientGone);
      try {
        observer.end();
        if (completed && observer.usage) {
          await settle(reservation.usageId, {
            status: "settled", ...usageOutcome(model, observer.usage), generationId: observer.generationId,
            streamedChars: observer.streamedChars, upstreamStatus: upstream.status,
          });
        } else {
          await markAborted(reservation.usageId, {
            generationId: observer.generationId, streamedChars: observer.streamedChars, upstreamStatus: upstream.status,
          });
        }
      } catch (error) {
        console.error("Recording LLM usage failed", reservation.usageId, error instanceof Error ? error.message : "Unknown error");
      } finally {
        finish();
      }
    };
    // Settlement runs after the response, whether the stream ends, breaks or the client leaves.
    after(() => finished);

    const passthrough = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            await record(true);
            return;
          }
          observer.push(value);
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          await record(false);
        }
      },
      async cancel() {
        upstreamAbort.abort();
        await reader.cancel().catch(() => {});
        await record(false);
      },
    });

    return new Response(passthrough, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
        "X-Accel-Buffering": "no",
        "X-Subtubes-Request-Id": reservation.usageId,
      },
    });
  });
}

// Refuses a body over the limit whether or not Content-Length told the truth.
async function readBody(request: Request, limitBytes: number): Promise<Uint8Array> {
  const tooLarge = () => new LlmError("payload_too_large", "The request is too large.", { limitBytes });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limitBytes) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new LlmError("invalid_request", "Send the request as the body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limitBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
