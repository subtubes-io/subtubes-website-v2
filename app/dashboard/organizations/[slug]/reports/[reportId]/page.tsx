import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ReportViewer } from "@/components/report/report-viewer";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { readWebsiteReport } from "@/lib/report-reader";
import type { WebsiteSnapshotMeta } from "@/components/report/report-viewer";
import Link from "next/link";

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

  const decoded = readWebsiteReport(reportRow);
  if (!decoded.report) {
    return (
      <section className="dashboard-wrap">
        <h1 className="dashboard-heading">{decoded.compatibility.status === "unsupported" ? "Requires a newer app" : "Invalid document"}</h1>
        <p>{reportRow.projectName} · Wire schema {reportRow.schemaVersion} · Revision {reportRow.revision}</p>
        <p>{decoded.compatibility.message}</p>
        <Link className="button-secondary" href={`/dashboard/organizations/${organization.slug}`}>All reports</Link>
      </section>
    );
  }

  const snapshotRows = await db
    .selectFrom("reportSnapshot")
    .selectAll()
    .where("organizationId", "=", organization.id)
    .where("reportId", "=", reportId)
    .orderBy("number", "asc")
    .execute();

  const snapshotMetas: WebsiteSnapshotMeta[] = snapshotRows.map((s) => {
    const decoded = readWebsiteReport(s);
    return {
      id: s.id,
      reportId: s.reportId,
      number: s.number,
      takenAt: s.takenAt.toISOString(),
      note: s.note ?? undefined,
      commit: decoded.commit,
      compatibility: decoded.compatibility,
    };
  });

  return (
    <ReportViewer
      report={decoded.report}
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
