import type { Report, Snapshot, SnapshotMeta } from "./model/types";

export function reportFixture(): Report {
  return {
    schemaVersion: 1, generatedAt: "2026-10-04T20:00:00Z", title: "Review <intent>", source: "agent",
    base: "abc", head: "def", narrative: "Overview <script>.\n\nBuild passed.", plugins: [],
    stats: { files: 2, additions: 25, deletions: 1 },
    groups: [{ kind: "feature", summary: "Readable <cards>", files: ["src/b.ts", "missing.ts"] }],
    flags: [], files: [
      { path: "src/a.ts", status: "modified", additions: 25, deletions: 1, hunks: [{ oldStart: 10, newStart: 10, changedLines: [10], lines: ["-old", "+new", ...Array.from({ length: 24 }, (_, i) => ` context ${i}`)] }] },
      { path: "src/b.ts", status: "added", additions: 1, deletions: 0, hunks: [{ oldStart: 0, newStart: 1, changedLines: [1], lines: ["+second file"] }] },
    ],
    result: { changedSymbols: [], callers: [], contractSurface: [], dataTouchpoints: [], flags: [], flows: [] },
    map: { layers: [], lanes: [], nodes: [], edges: [] },
  };
}
export function snapshotFixture(): Snapshot {
  return { id: "report-fixture", name: "Fixture review", savedAt: "2026-10-04T20:00:00Z", report: reportFixture() };
}
