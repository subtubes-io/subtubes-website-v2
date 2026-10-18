import { auth } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { db } from "@/lib/db/client";
import { ApiError, handle, NO_STORE } from "@/lib/pull-request-reports/errors";
import { ID_PATTERN } from "@/lib/pull-request-reports/http";
import { deleteReport } from "@/lib/pull-request-reports/store";

// Deleting a report from the website's management page. The desktop app uses the bearer API under /api/v1; this is the same deletion for a
// signed-in browser session, so it needs the website's own origin (a cross-site page cannot make it happen).
export function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string; reportId: string }> }) {
  return handle(async () => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new ApiError("unauthorized", "Sign in to manage reports.");
    if (!isTrustedAuthOrigin(request.headers.get("origin"))) throw new ApiError("forbidden", "Manage reports from this website.");

    const { organizationId, reportId } = await params;
    if (!ID_PATTERN.test(organizationId)) throw new ApiError("bad-request", "The organization id is not valid.");
    const member = await db
      .selectFrom("member")
      .where("organizationId", "=", organizationId)
      .where("userId", "=", session.user.id)
      .select("role")
      .executeTakeFirst();
    if (!member) throw new ApiError("organization-not-found", "No such organization.");

    const roles = member.role.split(",").map((role) => role.trim());
    await deleteReport(organizationId, reportId, {
      userId: session.user.id,
      canManage: roles.includes("owner") || roles.includes("admin"),
    });
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
