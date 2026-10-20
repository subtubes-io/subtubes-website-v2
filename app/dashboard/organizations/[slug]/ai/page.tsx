import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AiSettings } from "@/components/ai-settings";
import { aiOverview, organizationForPage } from "@/lib/llm/dashboard";
import { getSession } from "@/lib/session";

async function AiDetails({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}/ai`)}`);
  const organization = await organizationForPage(slug, session.user.id);
  if (!organization) notFound();
  const overview = await aiOverview(organization.id, session.user.id);

  return (
    <>
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-heading">AI usage</h1>
        </div>
      </header>
      <AiSettings config={{ organizationId: organization.id, canManage: organization.canManage, personal: organization.personal, overview }} />
    </>
  );
}

export default function AiPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="dashboard-empty">Loading AI usage...</p>}>
      <AiDetails params={params} />
    </Suspense>
  );
}
