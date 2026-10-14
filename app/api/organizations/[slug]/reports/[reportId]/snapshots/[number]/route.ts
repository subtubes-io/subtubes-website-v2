import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { requireWebsiteReport } from "@/lib/report-reader";
import { DocumentError, parseStoredJson } from "@/lib/cloud-push/document-compatibility";
import { errorResponse } from "@/lib/cloud-push/common";
import { reportDocument } from "@/lib/cloud-push/reports";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ slug: string; reportId: string; number: string }>;
  }
) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { slug, reportId, number: numberParam } = await params;
  const snapshotNumber = parseInt(numberParam, 10);
  if (Number.isNaN(snapshotNumber) || snapshotNumber < 1) {
    return new Response(JSON.stringify({ error: "invalid_number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const org = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();

  if (!org) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const snapshot = await db
    .selectFrom("reportSnapshot")
    .selectAll()
    .where("organizationId", "=", org.id)
    .where("reportId", "=", reportId)
    .where("number", "=", snapshotNumber)
    .executeTakeFirst();

  if (!snapshot) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let reportContent;
  try {
    requireWebsiteReport(snapshot);
    reportContent = reportDocument(snapshot);
  } catch (error) {
    if (error instanceof DocumentError) return errorResponse(error.status, error.code, error.message, error.details);
    throw error;
  }

  const commitData = snapshot.commit === null ? null : parseStoredJson(snapshot.commit, snapshot.id);

  return new Response(
    JSON.stringify({
      id: snapshot.id,
      reportId: snapshot.reportId,
      number: snapshot.number,
      takenAt: snapshot.takenAt.toISOString(),
      note: snapshot.note,
      commit: commitData,
      schemaVersion: snapshot.schemaVersion,
      contentHash: snapshot.contentHash,
      report: reportContent,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
