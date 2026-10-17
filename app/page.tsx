import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
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

export default function Home() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> Subtubes</p>
          <h1 className="hero-title">
            Your account.
            <span>Your organizations.</span>
          </h1>
          <p className="hero-description">
            Manage your Subtubes account, organize your team, and connect your
            desktop app securely.
          </p>
          <div className="hero-actions">
            <Suspense fallback={<span className="button-primary">Loading...</span>}>
              <HeroActions />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="feature-strip" aria-label="Account features">
        <div className="feature-grid">
          <article className="feature-item">
            <h2 className="feature-title">Your profile</h2>
            <p className="feature-description">Manage your account details, avatar, and profile links.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Your team</h2>
            <p className="feature-description">Create organizations, invite members, and manage access.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Desktop sign-in</h2>
            <p className="feature-description">Connect your desktop app securely with a short device code.</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <span>Subtubes</span>
        <nav className="site-footer-links" aria-label="Footer">
          <Link href="/api-page">API status</Link>
          <Link href="/device">Connect desktop app</Link>
        </nav>
      </footer>
    </main>
  );
}
