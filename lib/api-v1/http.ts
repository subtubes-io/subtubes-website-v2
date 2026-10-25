import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { ApiError } from "./errors";

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
  if (!authorization || !/^bearer\s+\S+$/i.test(authorization)) throw new ApiError("unauthorized", "Authentication required.");
  // Only the bearer token counts: a cookie that rides along is ignored.
  const session = await auth.api.getSession({ headers: new Headers({ authorization }) });
  if (!session) throw new ApiError("unauthorized", "Authentication required.");

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
