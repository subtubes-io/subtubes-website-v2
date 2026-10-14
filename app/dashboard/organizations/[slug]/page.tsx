import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { OrganizationTables } from "@/components/organization-tables";
import {
  OrganizationReportsList,
  type OrganizationReportSummary,
} from "@/components/report/organization-reports-list";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { readWebsiteReport } from "@/lib/report-reader";

async function OrganizationDetails({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}`)}`,
    );
  }

  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id", "organization.name", "organization.slug", "member.role"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();

  if (!organization) notFound();

  const canInvite = organization.role.split(",").some((role) => ["owner", "admin"].includes(role.trim()));
  const [members, invitations, reportRows, snapshotRows] = await Promise.all([
    db.selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .select(["member.id", "user.name", "user.email", "member.role"])
      .where("member.organizationId", "=", organization.id)
      .orderBy("member.createdAt", "asc")
      .orderBy("member.id", "asc")
      .execute(),
    canInvite ? db.selectFrom("invitation")
      .select(["id", "email", "role", "status", "expiresAt"])
      .where("organizationId", "=", organization.id)
      .orderBy("createdAt", "desc")
      .orderBy("id", "asc")
      .execute() : Promise.resolve([]),
    db.selectFrom("report")
      .selectAll()
      .where("organizationId", "=", organization.id)
      .orderBy("updatedAt", "desc")
      .execute(),
    db.selectFrom("reportSnapshot")
      .selectAll()
      .where("organizationId", "=", organization.id)
      .orderBy("number", "asc")
      .execute(),
  ]);

  const snapshotsByReport = new Map<string, typeof snapshotRows>();
  for (const s of snapshotRows) {
    const list = snapshotsByReport.get(s.reportId) ?? [];
    list.push(s);
    snapshotsByReport.set(s.reportId, list);
  }

  const reportSummaries: OrganizationReportSummary[] = reportRows.map((r) => {
    const decoded = readWebsiteReport(r);
    const reportData = decoded.report;
    const reportSnaps = snapshotsByReport.get(r.id) ?? [];
    const latestSnap = reportSnaps[reportSnaps.length - 1];
    const latestCommit = latestSnap ? readWebsiteReport(latestSnap).commit : undefined;
    const flags = reportData?.flags ?? [];
    const flagCounts = {
      high: flags.filter((f) => f.severity === "high").length,
      medium: flags.filter((f) => f.severity === "medium").length,
      low: flags.filter((f) => f.severity === "low").length,
    };

    return {
      id: r.id,
      name: reportData?.title || r.projectName || r.id,
      title: reportData?.title,
      compatibility: decoded.compatibility,
      projectName: r.projectName,
      savedAt: r.updatedAt.toISOString(),
      stats: reportData?.stats,
      snapshots: {
        count: reportSnaps.length,
        latest: latestSnap
          ? {
              number: latestSnap.number,
              takenAt: latestSnap.takenAt.toISOString(),
              commit: latestCommit,
            }
          : undefined,
      },
      info: {
        preview: reportData?.narrative?.slice(0, 200) || "",
        flags: flagCounts,
        shots: Object.keys(reportData?.shots ?? {}).length,
        visualScenarios: reportData?.visual?.scenarios?.length ?? 0,
        mapNodes: reportData?.map?.nodes?.length ?? 0,
        flows: reportData?.result?.flows?.length ?? 0,
        base: reportData?.base,
        head: reportData?.head,
      },
    };
  });

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">{organization.name}</h1>
        </div>
        <Link href="/dashboard" className="button-secondary">
          All organizations
        </Link>
      </header>

      <section className="dashboard-section" aria-labelledby="organization-reports">
        <OrganizationReportsList slug={slug} reports={reportSummaries} />
      </section>

      <section className="dashboard-section" aria-labelledby="organization-members-section">
        <h2 id="organization-members-section" className="dashboard-section-title">
          Organization Settings & Members
        </h2>
        <OrganizationTables config={{
          organizationId: organization.id,
          canInvite,
          members,
          invitations: invitations.map((invitation) => ({
            ...invitation,
            role: invitation.role ?? "member",
            expiresAt: invitation.expiresAt.toISOString(),
            status: invitation.status === "pending" && invitation.expiresAt <= new Date()
              ? "expired" : invitation.status,
          })),
        }} />
      </section>
    </>
  );
}

export default function OrganizationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="dashboard-wrap">
        <Suspense
          fallback={<p className="dashboard-empty">Loading organization...</p>}
        >
          <OrganizationDetails params={params} />
        </Suspense>
      </section>
    </main>
  );
}
