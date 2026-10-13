/** The keystone: every framework plugin returns this common shape. */
import type { Decision } from "./decisions";
import type { QaStep, QaWalkthrough } from "./qa";
import type { ReviewerEdits } from "./report-text";
import type { CommitBinding } from "./snapshots";
import type { ReportSwimlane } from "./report-swimlanes";

export interface Hunk {
  oldStart: number;
  newStart: number;
  /** New-side line numbers that were added or modified. */
  changedLines: number[];
  lines: string[];
}

export interface FileDiff {
  path: string;
  /** Human approval of this file's saved diff; absent means not reviewed. */
  reviewed?: boolean;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

export interface DiffInput {
  repoRoot: string;
  base: string; // git ref, or "WORKING" for uncommitted vs HEAD
  head: string;
  files: FileDiff[];
}

export interface SymbolRef {
  name: string;
  kind: "function" | "class" | "method" | "variable" | "type" | "route" | "other";
  file: string;
  line: number;
  exported: boolean;
}

export interface Caller {
  symbol: string;
  file: string;
  line: number;
  /** Argument count when this reference is a call expression. */
  args?: number;
}

/** A live Designs target, never an embedded diagram snapshot. */
export interface DesignRef {
  designId: string;
  nodeId?: string;
  /** Optional display label; IDs remain the navigation authority. */
  label?: string;
}

/** Data-flow picture of one changed function ("Flow" tab). */
export interface FlowNode {
  id: string;
  label: string;
  sub?: string;
  kind: "input" | "op" | "sink" | "return" | "caller";
  /** Untrusted or secret data is flowing somewhere it should not. */
  risk?: boolean;
  file?: string;
  line?: number;
  /** Saved lane-relative position in the Flow canvas. */
  position?: { x: number; y: number };
}

export interface FlowEdge {
  from: string;
  /** "__fn" targets the function box itself (used by callers). */
  to: string;
  label?: string;
  risk?: boolean;
}

export interface FlowGraph {
  id: string;
  title: string;
  file: string;
  line: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface DataTouchpoint {
  kind: "sql" | "orm" | "http" | "fs" | "env" | "queue" | "other";
  file: string;
  line: number;
  snippet: string;
}

export type FlagCategory = "security" | "data" | "config" | "dependency";

export interface Flag {
  category: FlagCategory;
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  message: string;
}

/** What a plugin returns for the files it claimed. */
export interface PluginResult {
  changedSymbols: SymbolRef[];
  callers: Caller[];
  /** Exported/public API symbols whose signature or behavior changed. */
  contractSurface: SymbolRef[];
  dataTouchpoints: DataTouchpoint[];
  flags: Flag[];
  flows: FlowGraph[];
}

export interface DiffPlugin {
  id: string;
  /** Step 1: detect. Return the files this plugin can analyze (empty = not applicable). */
  detect(input: DiffInput): string[] | Promise<string[]>;
  /** Step 2: analyze. */
  analyze(input: DiffInput, files: string[]): PluginResult | Promise<PluginResult>;
}

export type IntentGroupKind =
  | "feature"
  | "refactor"
  | "tests"
  | "security"
  | "config"
  | "deps"
  | "docs";

export interface IntentGroup {
  kind: IntentGroupKind;
  files: string[];
  summary: string;
}

/** Step 3: report. */
export interface Report {
  /** Optional embedded user-flow diagrams, independent of live Designs. */
  swimlanes?: ReportSwimlane[];
  /** Bump on breaking changes to this shape. */
  schemaVersion?: 1;
  title?: string;
  repoRoot?: string;
  /** Screenshots embedded as data URLs, keyed by file name like "home.before.png" (set when snapshotting). */
  shots?: Record<string, string>;
  visual?: VisualEvidence;
  /** "agent" when authored through publish_report, otherwise a heuristic draft. */
  source?: "agent" | "heuristic";
  generatedAt: string;
  base: string;
  head: string;
  narrative: string;
  stats: { files: number; additions: number; deletions: number };
  groups: IntentGroup[];
  flags: Flag[];
  plugins: string[];
  result: PluginResult;
  /** Layered architecture view; heuristic draft, replaceable by the agent. */
  map?: SystemMap;
  /** Additive, file-level module dependency evidence and reverse shortest-hop rings. */
  dependencies?: DependencyGraph;
  /** Objective change-risk facts derived from the diff and the dependency graph: reach, test coverage, sensitive surfaces. */
  risk?: RiskAnalysis;
  files: FileDiff[];
  /** Opens the current locally saved diagram, optionally selecting a node. */
  designRefs?: DesignRef[];
  /** Human judgement calls and agent assumptions behind the change, anchored to the code and diagrams they explain. */
  decisions?: Decision[];
  /** The QA walkthrough: ordered steps, each a screenshot and/or a Markdown note, showing how the change was exercised. */
  /** Older reports kept one flat list of steps here; read it with walkthroughsOf. */
  qa?: QaStep[];
  /** The QA walkthroughs: named runs of steps, each a screenshot and/or a Markdown note, showing how the change was exercised. */
  walkthroughs?: QaWalkthrough[];
  /** Counts every update of the living report, so a stale write can be told from a current one. */
  revision?: number;
  /** Wording a person changed in the report; an agent update re-applies it to the same title, narrative, intention or flag. */
  reviewerEdits?: ReviewerEdits;
}

export interface VisualAttempt {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  durationMs: number;
  retry: number;
  errors: string[];
}

export interface VisualScenario {
  id: string;
  title: string;
  file: string;
  line?: number;
  project: string;
  status: VisualAttempt["status"] | "flaky";
  attempts: VisualAttempt[];
  beforeAttempts?: VisualAttempt[];
  comparison: "snapshot-baseline" | "two-runs" | "capture";
  before?: string;
  after?: string;
  diff?: string;
  notes: string[];
}

/** Additive visual-evidence contract; images are embedded PNG data URLs. */
export interface VisualEvidence {
  version: 1;
  importedAt: string;
  source: "playwright-json";
  beforeRevision?: string;
  afterRevision?: string;
  scenarios: VisualScenario[];
  warnings: string[];
}

/** Resolved TypeScript/JavaScript module relationships and reverse shortest-hop reachability. */
export interface DependencyGraph {
  version: 1;
  roots: string[];
  nodes: { file: string; hop: number; via?: string }[];
  edges: { from: string; to: string; line: number; specifier: string; kind: "import" | "export" | "require" | "dynamic-import" }[];
  unresolved: { file: string; line: number; specifier: string; reason: string }[];
  limitations: string[];
  scannedFiles: number;
}

export type FileRole = "source" | "test" | "docs" | "config" | "other";

/** Reverse-import reach of one changed file. Counts are exact over the scanned TS/JS graph. */
export interface FileReach {
  file: string;
  role: FileRole;
  /** False when the file is outside the TS/JS graph or absent from the working tree; reach fields are then zero, not "none". */
  analyzed: boolean;
  deleted: boolean;
  /** Files importing this one directly. */
  direct: number;
  /** Files that reach this one through any chain of imports (excludes itself). */
  transitive: number;
  maxDepth: number;
  /** Import-reachable dependents, nearest first; capped, `transitive` is the true count. */
  dependents: string[];
  /** Non-test modules that nothing but tests import (entry points, scripts, config), including this file when it is one. */
  entryPoints: string[];
  /** Test files that import this file directly or transitively, or this file itself when it is a test. */
  tests: string[];
  /** Top-level directories that dependents live in. */
  boundaries: string[];
}

export type SensitiveKind =
  | "code-execution" | "shell" | "secret" | "html-injection" | "sql" | "tls" | "cors" | "auth-crypto" | "security-other"
  | "dependency-added" | "dependency-removed" | "dependency-changed" | "install-script"
  | "ci-workflow" | "infra" | "env-config" | "migration";

export interface SensitiveChange {
  kind: SensitiveKind;
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  message: string;
  /** entry-point: the file is itself an entry; reachable: an entry point imports it; unreached: no entry point imports it; not-analyzed: outside the TS/JS graph or n/a. */
  exposure: "entry-point" | "reachable" | "unreached" | "not-analyzed";
  entryPoints: string[];
}

export interface TestWeakening {
  kind: "deleted-test-file" | "skipped-or-focused" | "fewer-assertions";
  file: string;
  line?: number;
  detail: string;
}

export interface RiskAnalysis {
  version: 1;
  /** Changed files, widest reach first. */
  files: FileReach[];
  tests: {
    /** Changed, analyzable source files that no test file imports (directly or transitively). */
    untested: string[];
    /** Test files that import a changed file, plus test files changed in the diff. */
    testsToRun: string[];
    /** Source files changed but not a single test file changed. */
    sourceChangedWithoutTests: boolean;
    weakened: TestWeakening[];
  };
  sensitive: SensitiveChange[];
  /** Changed source files outside the TS/JS graph (Python, Rust, ...) that reach/test facts do not cover. */
  notAnalyzed: string[];
  scannedFiles: number;
  limitations: string[];
}

/** System map ("Map" tab): layered swimlane canvas, as in an architecture diagram. */
export type MapStatus = "new" | "changing" | "existing";

export interface MapNode {
  id: string;
  title: string;
  desc: string;
  layer: string;
  lane: string;
  status: MapStatus;
  file?: string;
  line?: number;
  risk?: boolean;
  /** Optional grid position inside its lane (otherwise nodes stack). */
  row?: number;
  col?: number;
  /** Saved canvas coordinates relative to the node area of its lane. */
  position?: { x: number; y: number };
}

export interface MapEdge {
  from: string;
  to: string;
  label?: string;
  /** Untrusted or secret data flows along this edge (drawn orange). */
  risk?: boolean;
}

export interface SystemMap {
  layers: { id: string; title: string }[];
  lanes: { id: string; layer: string; title: string }[];
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface SnapshotMeta {
  id: string;
  name: string;
  note?: string;
  savedAt: string;
  title?: string;
  repoRoot?: string;
  stats?: Report["stats"];
  /** How many snapshots the report has and the newest one. */
  snapshots?: { count: number; latest?: { number: number; takenAt: string; commit?: CommitBinding } };
  /** Derived by the app's list command from the saved report. */
  info?: { preview: string; flags: { high: number; medium: number; low: number }; source?: string; shots: number; visualScenarios?: number; mapNodes: number; flows: number; base?: string; head?: string };
}

export interface Snapshot extends SnapshotMeta {
  report: Report;
}
