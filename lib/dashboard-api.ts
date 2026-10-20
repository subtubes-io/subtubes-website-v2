import { auth } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { db } from "@/lib/db/client";

// The website's own management routes under /api/organizations: a signed-in browser session, sent from this website's origin, by a
// member of the organization. Failures are `{ error, message }` with no-store, like the rest of the API.

const STATUS = {
  "bad-request": 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "rate-limited": 429,
  internal: 500,
  unavailable: 503,
} as const;

export type DashboardErrorCode = keyof typeof STATUS;

export class DashboardError extends Error {
  constructor(readonly code: DashboardErrorCode, message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function handleDashboard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DashboardError) {
      const headers: Record<string, string> = { ...NO_STORE };
      if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
      return Response.json({ error: error.code, message: error.message }, { status: STATUS[error.code], headers });
    }
    console.error("Dashboard request failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "internal", message: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

export interface DashboardCaller {
  userId: string;
  email: string;
  roles: string[];
  canManage: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export async function requireMember(request: Request, organizationId: string): Promise<DashboardCaller> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DashboardError("unauthorized", "Sign in first.");
  if (!isTrustedAuthOrigin(request.headers.get("origin"))) throw new DashboardError("forbidden", "Use this website to make this change.");
  if (!ID_PATTERN.test(organizationId)) throw new DashboardError("bad-request", "The organization id is not valid.");
  const member = await db
    .selectFrom("member")
    .select("role")
    .where("organizationId", "=", organizationId)
    .where("userId", "=", session.user.id)
    .executeTakeFirst();
  if (!member) throw new DashboardError("not-found", "No such organization.");
  const roles = member.role.split(",").map((role) => role.trim());
  return { userId: session.user.id, email: session.user.email, roles, canManage: roles.includes("owner") || roles.includes("admin") };
}

export async function requireManager(request: Request, organizationId: string): Promise<DashboardCaller> {
  const caller = await requireMember(request, organizationId);
  if (!caller.canManage) throw new DashboardError("forbidden", "Only owners and admins can change this.");
  return caller;
}

export async function readJson(request: Request, limitBytes = 64 * 1024): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new DashboardError("bad-request", "Send JSON.");
  const text = await request.text();
  if (Buffer.byteLength(text) > limitBytes) throw new DashboardError("bad-request", "The request is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new DashboardError("bad-request", "The request is not valid JSON.");
  }
}

/** A dollar amount from a form: null clears it; otherwise 0 to 1,000,000 with at most cents. */
export function parseUsdLimit(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000
    || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
    throw new DashboardError("bad-request", `${field} must be an amount in dollars between 0 and 1,000,000, or empty for no limit.`);
  }
  return Math.round(value * 1_000_000);
}
