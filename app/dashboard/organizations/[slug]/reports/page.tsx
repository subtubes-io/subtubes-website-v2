import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { PullRequestReportsTable } from "@/components/pull-request-reports-table";
import { db } from "@/lib/db/client";
import { listReports } from "@/lib/pull-request-reports/store";
import { getSession } from "@/lib/session";

const PAGE_SIZE = 100;

async function Reports({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}/reports`)}`);
  }

  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id", "organization.name", "organization.slug", "member.role"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();
  if (!organization) notFound();

  const manages = organization.role.split(",").some((role) => ["owner", "admin"].includes(role.trim()));
  const { reports, nextCursor } = await listReports(organization.id, { limit: PAGE_SIZE });

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Reports</h1>
        </div>
      </header>

      <section className="dashboard-section" aria-labelledby="published-reports">
        <h2 id="published-reports" className="dashboard-section-title">Published pull-request reports</h2>
        <p className="dashboard-empty">
          Reports are published from the Subtubes desktop app and read there. Here you can see what has been published and delete a report.
          {manages ? " As an owner or admin you can delete any report." : " You can delete the reports you published."}
        </p>
        <PullRequestReportsTable config={{
          organizationId: organization.id,
          reports: reports.map((report) => ({
            id: report.id,
            title: report.title,
            branch: report.branch,
            repository: report.repositoryKey ?? "",
            commitCount: report.commitCount,
            fileCount: report.fileCount,
            additions: report.additions,
            deletions: report.deletions,
            sizeBytes: report.sizeBytes,
            createdAt: report.createdAt,
            publisher: report.createdBy.name ?? "Unknown",
            canDelete: manages || report.createdBy.id === session.user.id,
          })),
        }} />
        {nextCursor && <p className="dashboard-empty">Showing the newest {PAGE_SIZE} reports.</p>}
      </section>
    </>
  );
}

export default function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading reports...</p>}>
      <Reports params={params} />
    </Suspense>
  );
}
