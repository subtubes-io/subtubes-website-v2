import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PricingCards } from "@/components/pricing-cards";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";

export const metadata = { title: "Pricing | subtubes" };

// For visitors who are not signed in. Someone who is signed in manages their membership from the dashboard instead.
async function Pricing() {
  if (await getSession()) redirect("/dashboard/membership");
  return (
    <section className="pricing" aria-labelledby="pricing-title">
      <h1 id="pricing-title" className="pricing-heading">Pricing</h1>
      <p className="pricing-subheading">Subtubes is a systems design platform. Pay monthly, or save with a yearly plan.</p>
      <PricingCards action={(label) => (
        <Link href="/sign-up?next=/dashboard/membership" className="button-primary">{label}</Link>
      )} />
      <p className="pricing-subheading">
        Already have an account? <Link href="/sign-in?next=/dashboard/membership" className="text-link">Sign in</Link>
      </p>
    </section>
  );
}

export default function PricingPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <Suspense fallback={<p className="dashboard-empty">Loading...</p>}>
        <Pricing />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
