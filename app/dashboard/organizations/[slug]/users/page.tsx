import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { OrganizationTables } from "@/components/organization-tables";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";

async function OrganizationDetails({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}/users`)}`,
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
  const [members, invitations] = await Promise.all([
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
  ]);

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">Users</h1>
        </div>
      </header>

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

export default function UsersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading users...</p>}>
      <OrganizationDetails params={params} />
    </Suspense>
  );
}
