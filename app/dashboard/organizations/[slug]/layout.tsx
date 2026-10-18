import { Suspense, type ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { OrganizationShell } from "@/components/organization-shell";

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <Suspense fallback={<p className="dashboard-empty dashboard-wrap">Loading...</p>}>
        <OrganizationShell>{children}</OrganizationShell>
      </Suspense>
    </main>
  );
}
