import { Suspense } from "react";
import { AccountDetails } from "@/components/account-details";
import { SiteHeader } from "@/components/site-header";

export default function AccountPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="dashboard-wrap">
        <Suspense fallback={<p className="dashboard-empty">Loading account...</p>}>
          <AccountDetails section="account" />
        </Suspense>
      </section>
    </main>
  );
}
