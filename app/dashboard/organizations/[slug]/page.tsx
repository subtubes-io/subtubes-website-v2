import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";

// The organization's landing page is blank on purpose: the menu on the left leads to its pages.
async function Overview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/dashboard/organizations/${slug}`)}`);

  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select("organization.name")
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();
  if (!organization) notFound();

  return <h1 className="sr-only">{organization.name}</h1>;
}

export default function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <Overview params={params} />
    </Suspense>
  );
}
