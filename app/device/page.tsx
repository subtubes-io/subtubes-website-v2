import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeviceApproval } from "@/components/device-approval";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";

type Search = Promise<{ user_code?: string }>;

async function Device({ searchParams }: { searchParams: Search }) {
  const { user_code: userCode = "" } = await searchParams;
  if (!(await getSession())) redirect(`/sign-in?next=${encodeURIComponent(`/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ""}`)}`);
  return <DeviceApproval initialCode={userCode} />;
}

export default function DevicePage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-card">
          <p className="auth-kicker">Device authorization</p>
          <h1 className="auth-title">Connect the desktop app</h1>
          <p className="device-copy">Enter the code shown in Subtubes IRE to sign the app in to your account.</p>
          <Suspense fallback={<p className="text-slate-600">Loading...</p>}>
            <Device searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
