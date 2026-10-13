import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfileLinksEditor } from "@/components/profile-links";
import { db } from "@/lib/db/client";
import { emptyProfileLinks } from "@/lib/profile-links";

export async function AccountDetails({ section }: { section: "account" | "profile" }) {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=/dashboard/${section}`);
  const { user } = session;
  const links = section === "profile" ? await db.selectFrom("profileLinks")
    .select(["x", "linkedin", "github", "huggingface"]).where("userId", "=", user.id).executeTakeFirst() : undefined;
  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">{section === "account" ? "Account" : "Profile"}</h1>
        </div>
      </header>
      <div className={section === "profile" ? "profile-card" : undefined}>
      {section === "profile" && <ProfileAvatar image={user.image} name={user.name} username={user.username} />}
      {section === "account" && (
        <dl className="settings-details">
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Email verification</dt><dd>{user.emailVerified ? "Verified" : "Not verified"}</dd></div>
        </dl>
      )}
      {section === "profile" && <ProfileLinksEditor initialLinks={links ?? emptyProfileLinks} />}
      </div>
    </>
  );
}
