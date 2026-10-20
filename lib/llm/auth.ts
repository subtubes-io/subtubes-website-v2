import { clientIp, getRateLimiter } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";
import { LlmError } from "./errors";
import { findCallerByKey, type KeyCaller } from "./keys";

// The order of refusals for every /api/llm/v1 call: a key that is well-formed, known, not revoked and whose owner is still a member of
// its organization; then that person's request rate. All of it before the body is read.
export async function authenticateLlm(request: Request): Promise<KeyCaller> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^bearer\s+(\S+)$/i.exec(authorization);
  const caller = match ? await findCallerByKey(match[1]) : null;
  if (!caller) {
    const ip = await getRateLimiter().hit(`ip:${clientIp(request)}:llm-auth-fail`, RATE_LIMITS.llmAuthFailures());
    if (!ip.allowed) {
      throw new LlmError("rate_limited", "Too many requests with an invalid API key. Try again later.",
        { retryAfterSeconds: ip.retryAfterSeconds });
    }
    throw new LlmError("invalid_api_key", "Send a valid Subtubes API key as `Authorization: Bearer stl_...`.");
  }

  const limit = await getRateLimiter().hit(`user:${caller.userId}:llm`, RATE_LIMITS.llmRequests());
  if (!limit.allowed) {
    throw new LlmError("rate_limited", "Too many requests. Slow down and try again shortly.", { retryAfterSeconds: limit.retryAfterSeconds });
  }
  return caller;
}
