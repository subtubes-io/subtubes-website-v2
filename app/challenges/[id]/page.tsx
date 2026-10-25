import { Suspense } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import terraform from "@/lib/highlight-terraform";
import { notFound } from "next/navigation";
import { Play } from "lucide-react";
import { CodeBlock } from "@/components/code-block";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { MOCK_CHALLENGES, findChallenge, loadChallengeMarkdown } from "@/lib/challenges";

export function generateStaticParams() {
  return MOCK_CHALLENGES.map(({ id }) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const challenge = findChallenge((await params).id);
  return { title: `${challenge?.title ?? "Challenge"} | subtubes` };
}

// Code blocks are highlighted as TypeScript, Python or Terraform. A block with another language, or none, is shown plain.
const HIGHLIGHT = { languages: { typescript, python, terraform }, aliases: { typescript: ["ts", "tsx"], python: ["py"], terraform: ["tf", "hcl"] }, detect: false };

// Reading the id is inside Suspense, so the header and footer show straight away while the challenge streams in.
async function Challenge({ params }: { params: Promise<{ id: string }> }) {
  const challenge = findChallenge((await params).id);
  if (!challenge) notFound();
  const markdown = await loadChallengeMarkdown(challenge.id);

  return (
    <article className="challenges-page challenge-detail">
      <h1 className="dashboard-heading">{challenge.title}</h1>
      <p className="challenge-meta">{challenge.category} · {challenge.duration}</p>
      {/* Mock player: swap for the challenge's real video (Vimeo embed) once videos are attached. */}
      <div className="challenge-player" role="img" aria-label={`Video for ${challenge.title}`}>
        <Play size={40} fill="currentColor" aria-hidden="true" />
      </div>
      <div className="markdown"><Markdown rehypePlugins={[[rehypeHighlight, HIGHLIGHT]]} components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }}>{markdown}</Markdown></div>
    </article>
  );
}

export default function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="site-main">
      <SiteHeader />
      <Suspense fallback={<p className="dashboard-empty challenges-page">Loading...</p>}>
        <Challenge params={params} />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
