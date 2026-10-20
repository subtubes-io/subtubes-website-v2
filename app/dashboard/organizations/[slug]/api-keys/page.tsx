import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import { listApiKeys, organizationForPage } from "@/lib/llm/dashboard";
import { getSession } from "@/lib/session";

async function ApiKeysDetails({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}/api-keys`)}`);
  const organization = await organizationForPage(slug, session.user.id);
  if (!organization) notFound();
  const keys = await listApiKeys(organization.id, session.user.id, organization.canManage);
  const site = (process.env.BETTER_AUTH_URL || "https://subtubes.com").replace(/\/+$/, "");

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">API keys</h1>
        </div>
      </header>
      <ApiKeysPanel config={{
        organizationId: organization.id,
        currentUserId: session.user.id,
        canManage: organization.canManage,
        baseUrl: `${site}/api/llm/v1`,
        keys,
      }} />
    </>
  );
}

export default function ApiKeysPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading API keys...</p>}>
      <ApiKeysDetails params={params} />
    </Suspense>
  );
}
