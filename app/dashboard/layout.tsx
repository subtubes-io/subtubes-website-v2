import { Suspense, type ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { DashboardShell } from "@/components/dashboard-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <Suspense fallback={<p className="dashboard-empty dashboard-wrap">Loading...</p>}>
        <DashboardShell>{children}</DashboardShell>
      </Suspense>
    </main>
  );
}
