// Errors of the proxy under /api/llm/v1 are shaped like OpenAI's, `{ error: { message, type, code, param, details? } }`, so any
// OpenAI-compatible client shows them. `code` is stable and meant for programs; `message` is for a person.

export const LLM_ERROR_STATUS = {
  invalid_request: 400,
  invalid_api_key: 401,
  budget_exceeded: 402,
  insufficient_funds: 402,
  member_disabled: 403,
  model_not_enabled: 403,
  model_not_found: 404,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  too_many_in_flight: 429,
  internal_error: 500,
  upstream_error: 502,
  service_unavailable: 503,
} as const;

export type LlmErrorCode = keyof typeof LLM_ERROR_STATUS;

const TYPE: Partial<Record<LlmErrorCode, string>> = {
  invalid_api_key: "authentication_error",
  budget_exceeded: "budget_exceeded",
  insufficient_funds: "insufficient_quota",
  member_disabled: "permission_error",
  model_not_enabled: "permission_error",
  rate_limited: "rate_limit_error",
  too_many_in_flight: "rate_limit_error",
  upstream_error: "api_error",
  internal_error: "api_error",
  service_unavailable: "api_error",
};

export interface LlmErrorDetails {
  /** Which limit refused a request: the organization's budget, the member's cap or the money available. */
  scope?: "organization" | "member" | "funds" | "global";
  limitUsd?: number | null;
  spentUsd?: number;
  availableUsd?: number;
  requiredUsd?: number;
  resetsAt?: string;
  retryAfterSeconds?: number;
  enabledModels?: string[];
  limitBytes?: number;
}

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly details?: LlmErrorDetails,
    readonly param: string | null = null,
  ) {
    super(message);
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function llmErrorResponse(error: LlmError, extraHeaders: Record<string, string> = {}, status?: number): Response {
  const headers: Record<string, string> = { ...NO_STORE, ...extraHeaders };
  if (error.details?.retryAfterSeconds) headers["Retry-After"] = String(error.details.retryAfterSeconds);
  return Response.json(
    {
      error: {
        message: error.message,
        type: TYPE[error.code] ?? "invalid_request_error",
        code: error.code,
        param: error.param,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    { status: status ?? LLM_ERROR_STATUS[error.code], headers },
  );
}

export async function handleLlm(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LlmError) return llmErrorResponse(error);
    // Never log the request: it holds people's code.
    console.error("LLM request failed", error instanceof Error ? error.message : "Unknown error");
    return llmErrorResponse(new LlmError("internal_error", "Something went wrong. You were not charged."));
  }
}
