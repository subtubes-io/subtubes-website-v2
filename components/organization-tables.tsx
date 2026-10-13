"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Table } from "@/components/ui/table";

type Member = { id: string; name: string; email: string; role: string };
type Invitation = { id: string; email: string; role: string; status: string; expiresAt: string };
type OrganizationTablesConfig = {
  organizationId: string;
  canInvite: boolean;
  members: Member[];
  invitations: Invitation[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

export function OrganizationTables({ config }: { config: OrganizationTablesConfig }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function perform(id: string, action: () => Promise<void>) {
    setPending(id);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <section className="dashboard-section" aria-labelledby="organization-members">
        <h2 id="organization-members" className="sr-only">Members</h2>
        <Table<Member> config={{
          caption: "Members",
          columns: [
            { id: "name", header: "Name", cell: (member) => member.name },
            { id: "email", header: "Email", cell: (member) => member.email },
            { id: "role", header: "Role", cell: (member) => <span className={`organization-role organization-role-${member.role}`}>{member.role}</span> },
          ],
          rows: config.members,
          rowKey: (member) => member.id,
          emptyMessage: "No members to display.",
        }} />
      </section>
      {config.canInvite && (
        <section className="dashboard-section" aria-labelledby="organization-invitations">
          <h2 id="organization-invitations" className="dashboard-section-title">Invite people</h2>
          <p className="dashboard-empty">
            Invite someone as a member or admin. No email is sent; copy the invitation link and share it with the recipient.
          </p>
          <form className="organization-form" onSubmit={(event) => {
            event.preventDefault();
            void perform("create", async () => {
              const result = await authClient.organization.inviteMember({
                organizationId: config.organizationId,
                email: email.trim(),
                role,
              });
              if (result.error) throw new Error(result.error.message ?? "Could not create the invitation.");
              setEmail("");
              setNotice("Invitation created. Share its link with the recipient.");
              router.refresh();
            });
          }}>
            <label>
              <span className="sr-only">Invite email</span>
              <Input type="email" required maxLength={254} placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              <span className="sr-only">Invitation role</span>
              <select className="site-input invitation-role-select" value={role} onChange={(event) => {
                const value = event.target.value;
                if (value === "member" || value === "admin") setRole(value);
              }}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <Button type="submit" disabled={pending !== null}>
              {pending === "create" ? "Creating..." : "Create invitation"}
            </Button>
          </form>
          {error && <FormError>{error}</FormError>}
          {notice && <p className="dashboard-empty" role="status">{notice}</p>}
          <Table<Invitation> config={{
            caption: "Invitations",
            columns: [
              { id: "email", header: "Email", cell: (invitation) => invitation.email },
              { id: "role", header: "Role", cell: (invitation) => invitation.role },
              { id: "status", header: "Status", cell: (invitation) => invitation.status },
              { id: "expires", header: "Expires (UTC)", cell: (invitation) => dateFormatter.format(new Date(invitation.expiresAt)) },
              { id: "actions", header: "Actions", cell: (invitation) => invitation.status === "pending" ? (
                <div className="invitation-actions">
                  <a className="text-link" href={`/invitations/${encodeURIComponent(invitation.id)}`}>Invitation link</a>
                  <Button variant="secondary" disabled={pending !== null} onClick={() => void perform(invitation.id, async () => {
                    await navigator.clipboard.writeText(new URL(`/invitations/${encodeURIComponent(invitation.id)}`, window.location.origin).href);
                    setNotice("Invitation link copied.");
                  })}>Copy link</Button>
                  <Button variant="secondary" disabled={pending !== null} aria-label="Cancel invitation" onClick={() => void perform(invitation.id, async () => {
                    const result = await authClient.organization.cancelInvitation({ invitationId: invitation.id });
                    if (result.error) throw new Error(result.error.message ?? "Could not cancel the invitation.");
                    setNotice("Invitation canceled.");
                    router.refresh();
                  })}>Cancel invitation</Button>
                </div>
              ) : <span aria-label="No available actions">-</span> },
            ],
            rows: config.invitations,
            rowKey: (invitation) => invitation.id,
            emptyMessage: "No invitations yet.",
          }} />
        </section>
      )}
    </>
  );
}
