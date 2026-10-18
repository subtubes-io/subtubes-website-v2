import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { auth } from "../auth";
import { db } from "../db/client";
import { ReviewError } from "./errors";
import { limits } from "./manifest";
import { Reviews, type ReviewUser } from "./service";
import { createReviewStorage, ReviewStorageError } from "./storage";

export const reviews = new Reviews(db, createReviewStorage());
export const response = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function bearerHeaders(request: Request): Headers {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) {
    throw new ReviewError(401, "unauthorized", "Authentication required.");
  }
  return new Headers({ authorization });
}
export async function authenticate(request: Request): Promise<ReviewUser> {
  const session = await auth.api.getSession({ headers: bearerHeaders(request) });
  if (!session) throw new ReviewError(401, "unauthorized", "Authentication required.");
  return { id: session.user.id, name: session.user.name };
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ReviewError(415, "unsupported_media_type", "Use application/json.");
  }
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limits.requestBytes)) {
    throw new ReviewError(413, "too_large", "Request exceeds its byte limit.");
  }
  if (!request.body) throw new ReviewError(400, "invalid_request", "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limits.requestBytes) {
        await reader.cancel();
        throw new ReviewError(413, "too_large", "Request exceeds its byte limit.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  // Bound nesting before JSON.parse, including unknown fields ignored by envelope schemas.
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") {
      if (++depth > 32) throw new ReviewError(400, "invalid_request", "JSON nesting exceeds its limit.");
    } else if (char === "]" || char === "}") depth--;
  }
  try { return JSON.parse(text); }
  catch { throw new ReviewError(400, "invalid_request", "Invalid JSON."); }
}

export async function handle(request: Request, action: (user: ReviewUser) => Promise<Response>, kind = "read") {
  await connection();
  try {
    const user = await authenticate(request);
    await reviews.rate(user, kind, kind === "push" ? 30 : kind === "download" ? 300 : 120, kind === "push" ? 3600 : 60);
    return await action(user);
  } catch (error) { return failure(error); }
}

export function failure(error: unknown): Response {
  if (error instanceof ReviewError) {
    const result = response({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
    if (error.status === 429) result.headers.set("Retry-After", String(error.details?.retryAfter ?? 60));
    return result;
  }
  const incidentId = randomUUID();
  if (error instanceof ReviewStorageError) {
    console.error("Review storage operation failed", { incidentId, code: error.code });
    return response({ error: "storage_unavailable", message: "Private review storage is unavailable.", details: { incidentId } }, 503);
  }
  if (typeof error === "object" && error !== null && "code" in error && ["40P01", "40001"].includes(String(error.code))) {
    console.warn("Review transaction must be retried", { incidentId });
    const result = response({ error: "retry_transaction", message: "A concurrent change occurred; retry this request." }, 503);
    result.headers.set("Retry-After", "1");
    return result;
  }
  // Never log raw provider/database errors: they may contain URLs, request data or SQL parameters.
  console.error("Review API operation failed", { incidentId, type: error instanceof Error ? error.name : "unknown" });
  return response({ error: "internal_error", message: "The request could not be completed.", details: { incidentId } }, 500);
}
