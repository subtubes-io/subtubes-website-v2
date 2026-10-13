import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import { SiteHeader } from "@/components/site-header";
import { Table } from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";

async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/dashboard");
  const organizations = await auth.api.listOrganizations({ headers: await headers() });
  const memberships = organizations.length
    ? await db
        .selectFrom("member")
        .select(["organizationId", "role"])
        .where("userId", "=", session.user.id)
        .where("organizationId", "in", organizations.map(({ id }) => id))
        .execute()
    : [];
  const roleByOrganization = new Map(
    memberships.map(({ organizationId, role }) => [organizationId, role]),
  );
  const manageableOrganizationIds = memberships
    .filter(({ role }) => role === "owner" || role === "admin")
    .map(({ organizationId }) => organizationId);
  const pendingInvitations = manageableOrganizationIds.length
    ? await db
        .selectFrom("invitation")
        .select("organizationId")
        .select((expression) => expression.fn.count<number>("id").as("count"))
        .where("organizationId", "in", manageableOrganizationIds)
        .where("status", "=", "pending")
        .where("expiresAt", ">", new Date())
        .groupBy("organizationId")
        .execute()
    : [];
  const pendingInvitationCount = new Map(
    pendingInvitations.map(({ organizationId, count }) => [
      organizationId,
      Number(count),
    ]),
  );
  const visibleOrganizations = organizations.flatMap((organization) => {
    const role = roleByOrganization.get(organization.id);
    return role ? [{ ...organization, role }] : [];
  });

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Dashboard</h1>
        </div>
      </header>

      <section aria-labelledby="orgs" className="dashboard-section">
        <h2 id="orgs" className="sr-only">Organizations</h2>
        <CreateOrganizationForm />
        <Table config={{
          caption: "Organizations",
          columns: [
            { id: "name", header: "Organization", cell: (organization) => (
                <Link
                  href={`/dashboard/organizations/${encodeURIComponent(organization.slug)}`}
                  className="text-link"
                  aria-label={`Open ${organization.name}`}
                >
                  {organization.name}
                </Link>
            ) },
            { id: "slug", header: "Slug", cell: (organization) => <span className="organization-slug">{organization.slug}</span> },
            { id: "role", header: "Your role", cell: (organization) => <span className={`organization-role organization-role-${organization.role}`}>{organization.role}</span> },
            { id: "invitations", header: "Pending invitations", align: "right", cell: (organization) =>
              organization.role === "owner" || organization.role === "admin"
                ? pendingInvitationCount.get(organization.id) ?? 0
                : <span aria-label="Only owners and admins can view invitation counts">-</span> },
          ],
          rows: visibleOrganizations,
          rowKey: (organization) => organization.id,
          emptyMessage: "You are not in any organizations yet. Create one to share reports with your team.",
        }} />
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="dashboard-wrap">
        <Suspense fallback={<p className="text-slate-600">Loading...</p>}>
          <Dashboard />
        </Suspense>
      </section>
    </main>
  );
}
