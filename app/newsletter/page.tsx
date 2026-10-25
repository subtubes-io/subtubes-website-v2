import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";

type Search = Promise<{ status?: string | string[] }>;

const messages: Record<string, { title: string; body: string }> = {
  confirmed: { title: "You're subscribed", body: "Thanks for confirming. You'll get Subtubes product updates from now on." },
  invalid: { title: "That link doesn't work", body: "The confirmation link is invalid. Sign up again from the home page to get a new one." },
  error: { title: "Something went wrong", body: "We couldn't confirm your subscription. Please try the link again in a moment." },
};

async function Status({ searchParams }: { searchParams: Search }) {
  const status = (await searchParams).status;
  const message = messages[Array.isArray(status) ? status[0] : status ?? ""] ?? messages.invalid;
  return (
    <>
      <h1 className="auth-title">{message.title}</h1>
      <p className="auth-subtitle">{message.body}</p>
      <p className="auth-switch"><Link href="/" className="text-link">Back to Subtubes</Link></p>
    </>
  );
}

export default function NewsletterPage({ searchParams }: { searchParams: Search }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="auth-layout">
        <div className="auth-card">
          <p className="auth-kicker">Newsletter</p>
          <Suspense fallback={<p>Loading...</p>}>
            <Status searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
