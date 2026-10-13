"use client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Review } from "./Review";
import { SummaryPage } from "./SummaryPage";
import { reportServices } from "./services";
import { reportFixture } from "./fixtures";
import type { Report } from "./model/types";

function impactReport(): Report {
  const report = reportFixture();
  report.dependencies = {
    version: 1, roots: ["src/a.ts", "src/b.ts"], scannedFiles: 8,
    nodes: [
      { file: "src/a.ts", hop: 0 }, { file: "src/b.ts", hop: 0 },
      { file: "src/screen.tsx", hop: 1, via: "src/a.ts" },
      { file: "src/dashboard.tsx", hop: 2, via: "src/screen.tsx" },
      { file: "src/router.tsx", hop: 3, via: "src/dashboard.tsx" },
      { file: "src/main.tsx", hop: 4, via: "src/router.tsx" },
    ],
    edges: [
      { from: "src/screen.tsx", to: "src/a.ts", line: 4, specifier: "./a", kind: "import" },
      { from: "src/dashboard.tsx", to: "src/screen.tsx", line: 1, specifier: "./screen", kind: "import" },
      { from: "src/router.tsx", to: "src/dashboard.tsx", line: 1, specifier: "./dashboard", kind: "import" },
      { from: "src/main.tsx", to: "src/router.tsx", line: 1, specifier: "./router", kind: "import" },
    ],
    unresolved: [{ file: "src/a.ts", line: 1, specifier: "external", reason: "External package" }],
    limitations: ["Static TypeScript/JavaScript imports only."],
  };
  report.risk = {
    version: 1, scannedFiles: 8,
    files: [
      { file: "src/a.ts", role: "source", analyzed: true, deleted: false, direct: 1, transitive: 4, maxDepth: 4, dependents: ["src/screen.tsx", "src/dashboard.tsx"], entryPoints: ["src/main.tsx"], tests: ["test/a.test.ts"], boundaries: ["app"] },
      { file: "src/b.ts", role: "source", analyzed: true, deleted: false, direct: 0, transitive: 0, maxDepth: 0, dependents: [], entryPoints: ["src/b.ts"], tests: [], boundaries: [] },
      { file: "worker.py", role: "source", analyzed: false, deleted: false, direct: 0, transitive: 0, maxDepth: 0, dependents: [], entryPoints: [], tests: [], boundaries: [] },
    ],
    tests: { untested: ["src/b.ts"], testsToRun: ["test/a.test.ts"], sourceChangedWithoutTests: true,
      weakened: [{ kind: "skipped-or-focused", file: "test/a.test.ts", line: 3, detail: "it.skip('x')" }] },
    sensitive: [
      { kind: "shell", severity: "high", file: "src/a.ts", line: 12, message: "Shell/process execution", exposure: "reachable", entryPoints: ["src/main.tsx"] },
      { kind: "dependency-added", severity: "medium", file: "package.json", line: 5, message: "Dependency added: left-pad@^1.3.0", exposure: "not-analyzed", entryPoints: [] },
    ],
    notAnalyzed: ["worker.py"], limitations: ["Import-reachable is not coverage."],
  };
  report.result.changedSymbols = [
    { name: "same", kind: "function", file: "src/a.ts", line: 10, exported: true },
    { name: "same", kind: "function", file: "src/b.ts", line: 1, exported: false },
  ];
  report.result.contractSurface = [report.result.changedSymbols[0]];
  report.result.callers = [{ symbol: "same", file: "unknown.ts", line: 12 }];
  report.result.dataTouchpoints = [{ kind: "fs", file: "src/a.ts", line: 20, snippet: "<script>readFile(path)</script>" }];
  return report;
}

const openReview = (report: Report) => render(<Review config={{ report, snapshot: { id: "fixture", name: "Fixture", savedAt: "" }, onReports: vi.fn(), onSave: vi.fn(), notify: vi.fn() }} />);

test("Summary has no risk facts section or metric cards, and has no Blast radius page", async () => {
  const user = userEvent.setup(), report = impactReport(), onView = vi.fn(), onFile = vi.fn();
  report.files[0].reviewed = true;
  report.groups[0].files.unshift("src/a.ts");
  render(<SummaryPage config={{ report, onView, onFile }} />);
  expect(screen.getByText("Approved")).toBeTruthy();
  expect(screen.getByText("No saved diff")).toBeTruthy();
  expect(screen.getByText("This is not a guarantee that the change is safe.")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Tests and risk facts" })).toBeNull();
  expect(screen.queryByText(/Blast radius/)).toBeNull();
  expect(screen.queryByRole("group", { name: "Review metrics" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Files approved|Change groups|Reported flags/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "src/a.ts" }));
  expect(onFile).toHaveBeenLastCalledWith("src/a.ts");
});

test("a file's review shows its reach, sensitive changes and weakened tests", async () => {
  const user = userEvent.setup();
  openReview(impactReport());
  await user.click(screen.getByRole("button", { name: /^Changes/ }));
  const facts = within(screen.getByRole("region", { name: "Facts about this file" }));
  expect(facts.getByText(/Reach: 1 direct and 4 total dependents · 1 test file imports it/)).toBeTruthy();
  expect(facts.getByText("Shell/process execution")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /src\/b.ts/ }));
  expect(within(screen.getByRole("region", { name: "Facts about this file" })).getByText(/Reach: 0 direct and 0 total dependents · no test imports it/)).toBeTruthy();
});

test("empty Summary provides explicit missing-content states and disables unavailable views", () => {
  const report = reportFixture();
  report.narrative = "";
  report.files = [];
  report.groups = [];
  render(<SummaryPage config={{ report, onView: vi.fn(), onFile: vi.fn() }} />);
  expect(screen.getByText("No intent was provided.")).toBeTruthy();
  expect(screen.getByText("No change intentions were provided for this report.")).toBeTruthy();
});
