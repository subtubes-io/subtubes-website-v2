import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";

async function HeroActions() {
  const session = await getSession();

  return session ? (
    <Link href="/dashboard" className="button-primary">Open dashboard <span aria-hidden="true">↗</span></Link>
  ) : (
    <>
      <Link href="/sign-up" className="button-primary">Get started <span aria-hidden="true">↗</span></Link>
      <Link href="/sign-in" className="button-secondary">Sign in</Link>
    </>
  );
}

function ReviewPreview() {
  return (
    <div className="preview-window" aria-label="Example shared code review report">
      <div className="preview-topbar">
        <span className="preview-window-dot" />
        <span className="preview-window-dot" />
        <span className="preview-window-dot" />
        <span className="preview-title">subtubes — review report</span>
        <span aria-hidden="true">•••</span>
      </div>
      <div className="preview-body">
        <p className="preview-label">Shared review · 2 minutes ago</p>
        <h2 className="preview-heading">Improve session token handling</h2>
        <div className="preview-meta">
          <span className="preview-chip accent">3 findings</span>
          <span className="preview-chip">src/auth/session.ts</span>
          <span className="preview-chip">+18 −6</span>
        </div>
        <div className="diff-card">
          <div className="diff-file">src/auth/session.ts</div>
          <div className="diff-lines" aria-label="Code change preview">
            <span className="diff-line-number">41</span><span>const session = await loadSession(token)</span>
            <span className="diff-line-number">42</span><span className="diff-added">+ if (!session || session.expiresAt &lt; now) {"{"}</span>
            <span className="diff-line-number">43</span><span className="diff-added">+   return {`{ ok: false, reason: "expired" }`}</span>
            <span className="diff-line-number">44</span><span className="diff-added">+ {"}"}</span>
            <span className="diff-line-number">45</span><span>return {"{ ok: true, session }"}</span>
          </div>
        </div>
        <div className="preview-footer">
          <span>Shared with <strong>Platform team</strong></span>
          <span>Open report ↗</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> Subtubes IRE · Team review</p>
          <h1 className="hero-title">
            Code review,
            <span>in the same</span>
            <span>channel.</span>
          </h1>
          <p className="hero-description">
            Share code review reports from Subtubes IRE with your team.
            Keep findings, context, and collaboration together in one place.
          </p>
          <div className="hero-actions">
            <Suspense fallback={<span className="button-primary">Loading...</span>}>
              <HeroActions />
            </Suspense>
          </div>
          <p className="hero-note">Built for thoughtful reviews, not another noisy feed.</p>
        </div>
        <div className="hero-visual">
          <ReviewPreview />
        </div>
      </section>

      <section className="feature-strip" aria-label="Product features">
        <div className="feature-grid">
          <article className="feature-item">
            <h2 className="feature-title">Keep the full context</h2>
            <p className="feature-description">Findings and code changes stay together in a clear, shareable report.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Work as a team</h2>
            <p className="feature-description">Create an organization and make review collaboration easier to follow.</p>
          </article>
          <article className="feature-item">
            <h2 className="feature-title">Made for Subtubes IRE</h2>
            <p className="feature-description">Sign in once and approve the desktop app securely with a short device code.</p>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <span>Subtubes · A home for your code reviews</span>
        <nav className="site-footer-links" aria-label="Footer">
          <Link href="/api-page">API status</Link>
          <Link href="/device">Connect desktop app</Link>
        </nav>
      </footer>
    </main>
  );
}
