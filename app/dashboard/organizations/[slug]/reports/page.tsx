import { Suspense } from "react";
import { redirect } from "next/navigation";

async function Redirector({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/dashboard/organizations/${slug}`);
  return null;
}

export default function ReportsIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <Redirector params={params} />
    </Suspense>
  );
}
