import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { AcceptInvitation } from "@/components/accept-invitation";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";

async function InvitationDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/invitations/${id}`)}`);
  const invitation = await db.selectFrom("invitation")
    .innerJoin("organization", "organization.id", "invitation.organizationId")
    .select(["invitation.id", "invitation.email", "invitation.role", "invitation.status", "invitation.expiresAt", "organization.name", "organization.slug"])
    .where("invitation.id", "=", id)
    .executeTakeFirst();
  let message: string | undefined;
  if (!invitation) message = "This invitation is unavailable.";
  else if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) message = "This invitation is for a different email address.";
  else if (invitation.status !== "pending" || invitation.expiresAt <= new Date()) message = "This invitation has expired or is no longer pending.";
  if (message || !invitation) return (
    <>
      <h1 className="dashboard-heading">Invitation unavailable</h1>
      <p className="dashboard-empty" role="alert">{message}</p>
      <Link className="text-link" href="/dashboard">Back to dashboard</Link>
    </>
  );
  return (
    <>
      <h1 className="dashboard-heading">Join {invitation.name}</h1>
      <p className="dashboard-empty">You have been invited as {invitation.role ?? "member"}.</p>
      <AcceptInvitation config={{ invitationId: invitation.id, organizationSlug: invitation.slug }} />
    </>
  );
}

export default function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="dashboard-wrap">
        <Suspense fallback={<p className="dashboard-empty">Loading invitation...</p>}>
          <InvitationDetails params={params} />
        </Suspense>
      </section>
    </main>
  );
}
