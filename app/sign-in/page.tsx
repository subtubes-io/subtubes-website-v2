import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { GitHubButton } from "@/components/github-button";
import { PasswordSignInForm } from "@/components/password-sign-in-form";
import { SiteHeader } from "@/components/site-header";
import { githubConfigured } from "@/lib/auth";
import { getSession, safeNext } from "@/lib/session";

type Search = Promise<{ next?: string | string[] }>;

async function SignIn({ searchParams }: { searchParams: Search }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <>
      <PasswordSignInForm next={next} />
      <p className="auth-switch">
        New here? <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="text-link">Create an account</Link>
      </p>
      <div className="auth-divider">or</div>
      {!githubConfigured && (
        <p role="status" className="notice">
          GitHub sign-in is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local (see .env.example).
        </p>
      )}
      <GitHubButton callbackURL={next} disabled={!githubConfigured} />
    </>
  );
}

export default function SignInPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-card">
          <p className="auth-kicker">Welcome back</p>
          <h1 className="auth-title">Sign in to Subtubes</h1>
          <p className="auth-subtitle">Access your shared code reviews and team workspace.</p>
        <Suspense fallback={<p className="text-slate-600">Loading...</p>}>
          <SignIn searchParams={searchParams} />
        </Suspense>
        </div>
      </section>
    </main>
  );
}
