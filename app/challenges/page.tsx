import { Suspense } from "react";
import { ChallengeList } from "@/components/challenge-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { MOCK_CHALLENGES } from "@/lib/challenges";

export const metadata = { title: "Challenges | subtubes" };

export default function ChallengesPage() {
  return (
    <main className="site-main">
      <SiteHeader />
      <section className="challenges-page" aria-labelledby="challenges-title">
        <h1 id="challenges-title" className="dashboard-heading">Challenges</h1>
        <p className="dashboard-empty">Each challenge comes with a video. Pick one to watch it and get started.</p>
        <Suspense fallback={<p className="dashboard-empty">Loading...</p>}>
          <ChallengeList challenges={MOCK_CHALLENGES} />
        </Suspense>
      </section>
      <SiteFooter />
    </main>
  );
}
