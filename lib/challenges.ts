// Mock data for the challenges. Each challenge has one video, and its id is the page: /challenges/<id>. Replace with real videos once there is a source for categories and durations.
export const CHALLENGE_CATEGORIES = ["Getting started", "Diagrams", "Code", "Scenarios", "Teams"] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export interface Challenge {
  id: string;
  title: string;
  description: string;
  category: ChallengeCategory;
  /** Length of the challenge's video. */
  duration: string;
}

export const findChallenge = (id: string) => MOCK_CHALLENGES.find((challenge) => challenge.id === id);

export const MOCK_CHALLENGES: Challenge[] = [
  { id: "1", title: "Diagram a system in minutes", description: "Add nodes, connect them and group them into a first design.", category: "Getting started", duration: "4:12" },
  { id: "2", title: "A tour of the desktop app", description: "Install the app and open your first project folder.", category: "Getting started", duration: "6:30" },
  { id: "3", title: "Swimlane designs", description: "Lay out who does what with lanes, in either orientation.", category: "Diagrams", duration: "5:48" },
  { id: "4", title: "Writing node descriptions in Markdown", description: "Keep the reasoning next to the box it explains.", category: "Diagrams", duration: "3:20" },
  { id: "5", title: "Connect a design to your code", description: "Link nodes to files and lines in your repository.", category: "Code", duration: "7:05" },
  { id: "6", title: "Generate code from a diagram", description: "Turn a design into starter files that follow your conventions.", category: "Code", duration: "8:41" },
  { id: "7", title: "Walk through a scenario", description: "Script a path through the diagram and see where it ends.", category: "Scenarios", duration: "5:02" },
  { id: "8", title: "Branching scenarios with inputs", description: "Change an input and watch the run take a different path.", category: "Scenarios", duration: "6:15" },
  { id: "9", title: "Review a design with your team", description: "Share a design and collect comments on specific nodes.", category: "Teams", duration: "4:55" },
  { id: "10", title: "Keeping designs and code in sync", description: "Spot drift between the diagram and the repository.", category: "Teams", duration: "9:10" },
];

// A challenge's page is written in Markdown: content/challenges/<id>.md. Ids come from the list above, never from the visitor.
export async function loadChallengeMarkdown(id: string): Promise<string> {
  if (!findChallenge(id)) return "";
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return readFile(join(process.cwd(), "content", "challenges", `${id}.md`), "utf8");
}
