// Every failure of the bearer-token API under /api/v1 is `{ error, message, details? }` with `Cache-Control: no-store`. `error` is for the app
// to act on and never changes meaning; `message` is for a person.

export const ERROR_STATUS = {
  "bad-request": 400,
  unauthorized: 401,
  forbidden: 403,
  "organization-not-found": 404,
  "payload-too-large": 413,
  "key-not-found": 404,
  "rate-limited": 429,
  internal: 500,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorDetails {
  issues?: { path: string; message: string }[];
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(error: ApiError): Response {
  const body: { error: ErrorCode; message: string; details?: ErrorDetails } = { error: error.code, message: error.message };
  if (error.details) body.details = error.details;
  const headers: Record<string, string> = { ...NO_STORE };
  if (error.code === "rate-limited" && error.details?.retryAfterSeconds) headers["Retry-After"] = String(error.details.retryAfterSeconds);
  return Response.json(body, { status: ERROR_STATUS[error.code], headers });
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("API request failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse(new ApiError("internal", "Something went wrong."));
  }
}
