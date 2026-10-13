import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ReportViewer } from "@/components/report/report-viewer";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import type { Report, ReportSnapshotMeta } from "@subtubes/report-ui";

async function ReportDetails({
  params,
}: {
  params: Promise<{ slug: string; reportId: string }>;
}) {
  const { slug, reportId } = await params;
  const session = await getSession();
  if (!session) {
    redirect(
      `/sign-in?next=${encodeURIComponent(
        `/dashboard/organizations/${slug}/reports/${reportId}`
      )}`
    );
  }

  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id", "organization.name", "organization.slug"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();

  if (!organization) notFound();

  const reportRow = await db
    .selectFrom("report")
    .selectAll()
    .where("id", "=", reportId)
    .where("organizationId", "=", organization.id)
    .executeTakeFirst();

  if (!reportRow) notFound();

  let rawReport: unknown;
  try {
    rawReport = JSON.parse(reportRow.report);
  } catch {
    notFound();
  }

  if (!rawReport || typeof rawReport !== "object") {
    notFound();
  }

  const snapshotRows = await db
    .selectFrom("reportSnapshot")
    .select(["id", "reportId", "number", "takenAt", "note", "commit"])
    .where("organizationId", "=", organization.id)
    .where("reportId", "=", reportId)
    .orderBy("number", "asc")
    .execute();

  const snapshotMetas: ReportSnapshotMeta[] = snapshotRows.map((s) => {
    let commitData: any = undefined;
    if (s.commit) {
      try {
        commitData = JSON.parse(s.commit);
      } catch {
        commitData = undefined;
      }
    }
    return {
      id: s.id,
      reportId: s.reportId,
      number: s.number,
      takenAt: s.takenAt.toISOString(),
      note: s.note ?? undefined,
      commit: commitData,
    };
  });

  return (
    <ReportViewer
      report={rawReport as Report}
      reportId={reportRow.id}
      projectName={reportRow.projectName}
      slug={organization.slug}
      snapshots={snapshotMetas}
    />
  );
}

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ slug: string; reportId: string }>;
}) {
  return (
    <main className="site-main report-site-main">
      <SiteHeader />
      <Suspense fallback={<p className="dashboard-empty">Loading report...</p>}>
        <ReportDetails params={params} />
      </Suspense>
    </main>
  );
}
