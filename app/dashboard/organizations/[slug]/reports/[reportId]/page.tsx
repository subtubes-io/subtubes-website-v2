import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ReportViewer } from "@/components/report/report-viewer";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { readWebsiteReport } from "@/lib/report-reader";
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

  return (
    <ReportViewer
      report={decoded.report}
      reportId={reportRow.id}
      projectName={reportRow.projectName}
      slug={organization.slug}
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
