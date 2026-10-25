import Link from "next/link";
import { Suspense } from "react";
import { PricingCards } from "@/components/pricing-cards";
import { VideoCarousel } from "@/components/video-carousel";
import { loadVideos } from "@/lib/videos";
import { NewsletterSignup } from "@/components/newsletter-signup";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getMembership } from "@/lib/membership/membership";
import { hasMembership } from "@/lib/membership/plan";
import { getSession } from "@/lib/session";

async function HeroActions() {
  const session = await getSession();

  return session ? (
    <Link href="/dashboard" className="button-primary">Open dashboard</Link>
  ) : (
    <>
      <Link href="/sign-up" className="button-primary">Get started</Link>
      <Link href="/sign-in" className="button-secondary">Sign in</Link>
    </>
  );
}

async function MembershipAction({ label }: { label: string }) {
  const session = await getSession();
  const member = session ? hasMembership((await getMembership(session.user.id))?.status) : false;
  if (member) return <Link href="/dashboard/membership" className="button-secondary">Manage membership</Link>;
  return (
    <Link href={session ? "/dashboard/membership" : "/sign-up?next=/dashboard/membership"} className="button-primary">
      {label}
    </Link>
  );
}

async function Videos() {
  const videos = await loadVideos();
  if (videos.length === 0) return null;
  return (
    <section className="videos" aria-label="Videos">
      <VideoCarousel videos={videos} />
    </section>
  );
}

export default function Home() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> Subtubes</p>
          <h1 className="hero-title">
            Design your systems.
            <span>Tie them to your code.</span>
          </h1>
          <p className="hero-description">
            Subtubes is a systems design platform. Diagram how your system works, connect each design to the code that implements it, and keep the two in step.
          </p>
          <div className="hero-actions">
            <Suspense fallback={<span className="button-primary">Loading...</span>}>
              <HeroActions />
            </Suspense>
          </div>
        </div>
      </section>

      <Suspense fallback={null}>
        <Videos />
      </Suspense>

      <section className="pricing" aria-labelledby="pricing-title">
        <h2 id="pricing-title" className="pricing-heading">Simple pricing</h2>
        <p className="pricing-subheading">One membership. Pay monthly or save with a yearly plan.</p>
        <PricingCards action={(label) => (
          <Suspense fallback={<span className="button-primary">Loading...</span>}>
            <MembershipAction label={label} />
          </Suspense>
        )} />
      </section>

      <section className="feature-strip" aria-label="Platform features">
        <div className="feature-grid">
          <article className="feature-item">
            <h2 className="feature-title">Diagram your systems</h2>
            <p className="feature-description">Map services, data and flows as diagrams you can read at a glance.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Connect designs to code</h2>
            <p className="feature-description">Relate every part of a design to the real code behind it.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Use the desktop app</h2>
            <p className="feature-description">Sign in to the desktop app securely with a short device code.</p>
          </article>
        </div>
      </section>

      <section className="newsletter" aria-labelledby="newsletter-title">
        <div className="newsletter-inner">
          <div>
            <h2 id="newsletter-title" className="feature-title">Newsletter</h2>
            <p className="feature-description">Product updates from Subtubes, now and then.</p>
          </div>
          <NewsletterSignup />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
