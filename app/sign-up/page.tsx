import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { GitHubButton } from "@/components/github-button";
import { SignUpForm } from "@/components/sign-up-form";
import { SiteHeader } from "@/components/site-header";
import { githubConfigured } from "@/lib/auth";
import { getSession, safeNext } from "@/lib/session";

type Search = Promise<{ next?: string | string[] }>;

async function SignUp({ searchParams }: { searchParams: Search }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <>
      <SignUpForm next={next} />
      <p className="auth-switch">
        Already have an account? <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="text-link">Sign in</Link>
      </p>
      {githubConfigured && (
        <div className="mt-5">
          <div className="auth-divider">or</div>
          <GitHubButton callbackURL={next} />
        </div>
      )}
    </>
  );
}

export default function SignUpPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-card">
          <p className="auth-kicker">Join your team</p>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">Set up your Subtubes workspace and share your first review.</p>
          <Suspense fallback={<p className="text-slate-600">Loading...</p>}>
            <SignUp searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
