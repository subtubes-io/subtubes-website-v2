import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { ApiError } from "./errors";
import { LIMITS } from "./schema";

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export interface Caller {
  userId: string;
  // A member may hold several roles, stored comma-separated.
  roles: string[];
}

// The bearer session, then the id in the path, then membership: each refusal is decided before the body is read. A person who is not a
// member gets the same answer as for an organization that does not exist, so ids cannot be probed.
export async function authorize(request: Request, organizationId: string): Promise<Caller> {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^bearer\s+\S+$/i.test(authorization)) throw unauthorized();
  // Only the bearer token counts: a cookie that rides along is ignored.
  const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
  if (!session) throw unauthorized();

  if (!ID_PATTERN.test(organizationId)) throw new ApiError("bad-request", "The organization id is not valid.");
  const member = await db
    .selectFrom("member")
    .where("organizationId", "=", organizationId)
    .where("userId", "=", session.user.id)
    .select("role")
    .executeTakeFirst();
  if (!member) throw new ApiError("organization-not-found", "No such organization.");

  return { userId: session.user.id, roles: member.role.split(",").map((role) => role.trim()) };
}

export const canManage = (caller: Caller) => caller.roles.includes("owner") || caller.roles.includes("admin");

function unauthorized() {
  return new ApiError("unauthorized", "Authentication required.");
}

export function requireJson(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new ApiError("unsupported-media-type", "Send the report as application/json.");
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !ID_PATTERN.test(key)) {
    throw new ApiError("bad-request", "Send an Idempotency-Key of up to 80 letters, digits, underscores or hyphens.");
  }
  return key;
}

// Reads the body, refusing one over the limit whether or not Content-Length told the truth.
export async function readBody(request: Request): Promise<Uint8Array> {
  const tooLarge = () => new ApiError("payload-too-large", "This report is too large to publish.", { limitBytes: LIMITS.maxBodyBytes });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LIMITS.maxBodyBytes) throw tooLarge();

  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("bad-request", "Send the report as the request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.maxBodyBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
