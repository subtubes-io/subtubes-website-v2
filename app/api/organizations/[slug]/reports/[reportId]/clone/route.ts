import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { DocumentError } from "@/lib/cloud-push/document-compatibility";
import { errorResponse, jsonResponse } from "@/lib/cloud-push/common";
import { cloneReport } from "@/lib/cloud-push/reports";

/** Makes an independent copy of a report for the signed-in member, from the website. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; reportId: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse(403, "forbidden", "Cross-site requests are not allowed.");
  }
  const session = await getSession();
  if (!session) return errorResponse(401, "unauthenticated", "Sign in to clone this report.");

  const { slug, reportId } = await params;
  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();
  if (!organization) return errorResponse(404, "not_found", "Organization not found.");

  try {
    return jsonResponse(await cloneReport(db, organization.id, reportId, session.user.id, { versions: [2], explicit: true }), 201);
  } catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    throw error;
  }
}
