import type { DependencyGraph, FileDiff, MapNode, PluginResult, Report, RiskAnalysis, SystemMap } from "./model/types";
import { decisions as decisionRecords } from "./model/decisions";
import { DesignRefsSchema, dedupeDesignRefs } from "./model/report-design-refs";
import { reportSwimlanes } from "./model/report-swimlanes";

// This preserves the legacy paste/import contract; schema-version policy is a separate change.
function dependencyGraph(value: unknown): DependencyGraph | undefined {
  if (value === undefined) return undefined;
  const invalid = (): undefined => undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const graph = value as Partial<DependencyGraph>;
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
  const positiveInteger = (item: unknown): item is number => Number.isSafeInteger(item) && (item as number) > 0;
  if (graph.version !== 1 || !strings(graph.roots) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || !Array.isArray(graph.unresolved) || !strings(graph.limitations) || !Number.isSafeInteger(graph.scannedFiles)
    || (graph.scannedFiles as number) < 0) return invalid();

  const nodes = new Map<string, { hop: number; via?: string }>();
  for (const item of graph.nodes) {
    if (!record(item) || typeof item.file !== "string" || !item.file || !Number.isSafeInteger(item.hop) || (item.hop as number) < 0
      || (item.via !== undefined && (typeof item.via !== "string" || !item.via)) || nodes.has(item.file)) return invalid();
    nodes.set(item.file, { hop: item.hop as number, via: item.via as string | undefined });
  }
  const roots = new Set(graph.roots);
  if (roots.size !== graph.roots.length || [...roots].some((file) => nodes.get(file)?.hop !== 0)) return invalid();

  const edgePairs = new Set<string>();
  for (const item of graph.edges) {
    if (!record(item) || typeof item.from !== "string" || typeof item.to !== "string" || typeof item.specifier !== "string"
      || !item.specifier || !positiveInteger(item.line)
      || !["import", "export", "require", "dynamic-import"].includes(String(item.kind))
      || !nodes.has(item.from) || !nodes.has(item.to)) return invalid();
    edgePairs.add(`${item.from}\u0000${item.to}`);
  }
  for (const [file, node] of nodes) {
    if ((node.hop === 0) !== roots.has(file) || (node.hop === 0) !== (node.via === undefined)) return invalid();
    if (node.via !== undefined && (nodes.get(node.via)?.hop !== node.hop - 1 || !edgePairs.has(`${file}\u0000${node.via}`))) return invalid();
  }
  for (const item of graph.unresolved) {
    if (!record(item) || typeof item.file !== "string" || !nodes.has(item.file) || typeof item.specifier !== "string"
      || typeof item.reason !== "string" || !item.reason || !positiveInteger(item.line)) return invalid();
  }
  return graph as DependencyGraph;
}

/** Derived, display-only facts; anything malformed is dropped instead of rejecting the report. */
function riskAnalysis(value: unknown): RiskAnalysis | undefined {
  const risk = value as Partial<RiskAnalysis> | undefined;
  if (!risk || typeof risk !== "object" || risk.version !== 1 || !Array.isArray(risk.files) || !Array.isArray(risk.sensitive)
    || !risk.tests || !Array.isArray(risk.tests.untested) || !Array.isArray(risk.tests.testsToRun) || !Array.isArray(risk.tests.weakened)
    || !Array.isArray(risk.notAnalyzed) || !Array.isArray(risk.limitations)) return undefined;
  const list = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
  const count = (item: unknown): item is number => Number.isSafeInteger(item) && (item as number) >= 0;
  const filesValid = risk.files.every((f) => f && typeof f.file === "string" && typeof f.analyzed === "boolean" && count(f.direct) && count(f.transitive)
    && count(f.maxDepth) && list(f.dependents) && list(f.entryPoints) && list(f.tests) && list(f.boundaries));
  const sensitiveValid = risk.sensitive.every((s) => s && typeof s.file === "string" && typeof s.message === "string" && Number.isSafeInteger(s.line) && list(s.entryPoints));
  return filesValid && sensitiveValid && list(risk.tests.untested) && list(risk.tests.testsToRun) && list(risk.notAnalyzed) && list(risk.limitations)
    ? { ...(risk as RiskAnalysis), scannedFiles: count(risk.scannedFiles) ? risk.scannedFiles : 0 } : undefined;
}


export function normalizeReport(raw: unknown): Report | string {
  if (!raw || typeof raw !== "object") return "That is not a JSON object.";
  const envelope = raw as { report?: unknown };
  const value = envelope.report && typeof envelope.report === "object" ? envelope.report : raw;
  const j = value as Partial<Omit<Report, "result">> & { flows?: PluginResult["flows"]; result?: Partial<PluginResult> };
  const dependencies = dependencyGraph(j.dependencies);
  const designRefs = DesignRefsSchema.safeParse(j.designRefs === undefined ? [] : j.designRefs);
  if (!designRefs.success) return "This report has invalid design references.";
  const swimlanes = reportSwimlanes.safeParse(j.swimlanes === undefined ? [] : j.swimlanes);
  if (!swimlanes.success) return "This report has invalid swimlane diagrams.";
  const decisions = decisionRecords.safeParse(j.decisions === undefined ? [] : j.decisions);
  if (!decisions.success) return "This report has invalid decisions.";
  if (j.dependencies !== undefined && !dependencies) return "This report has invalid dependency graph evidence.";
  const arr = <T,>(v: T[] | undefined): T[] => Array.isArray(v) ? v : [];
  const hasMap = j.map && Array.isArray(j.map.nodes) && Array.isArray(j.map.layers) && Array.isArray(j.map.lanes);
  if (!(j.files || j.narrative || hasMap || arr(j.flows).length || arr(j.groups).length || swimlanes.data.length)) {
    return "This does not look like a Diff Engine report (expected narrative, map, flows, groups or files).";
  }
  const files = [...arr(j.files)];
  if (!files.length) {
    const paths = new Set<string>();
    for (const g of arr(j.groups)) for (const f of arr(g.files)) paths.add(f);
    for (const f of arr(j.flags)) if (f.file) paths.add(f.file);
    if (hasMap) for (const n of j.map!.nodes) if (n.file) paths.add(n.file);
    for (const path of paths) files.push({ path, status: "modified", hunks: [], additions: 0, deletions: 0 });
  }
  if (hasMap && j.map?.edges?.some((e) => !j.map!.nodes.some((n) => n.id === e.from) || !j.map!.nodes.some((n) => n.id === e.to))) {
    console.warn("pasted map has edges that reference missing nodes; they will not be drawn");
  }
  const res = j.result ?? {};
  return {
    schemaVersion: 1, source: j.source ?? "agent", title: j.title, repoRoot: j.repoRoot, shots: j.shots, visual: j.visual, dependencies, risk: riskAnalysis(j.risk),
    ...(designRefs.data.length ? { designRefs: dedupeDesignRefs(designRefs.data) } : {}),
    ...(swimlanes.data.length ? { swimlanes: swimlanes.data } : {}),
    generatedAt: j.generatedAt ?? new Date().toISOString(), base: j.base ?? "pasted", head: j.head ?? "report",
    narrative: j.narrative ?? "", stats: j.stats ?? { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) },
    groups: arr(j.groups), flags: arr(j.flags), plugins: arr(j.plugins),
    result: { changedSymbols: arr(res.changedSymbols), callers: arr(res.callers), contractSurface: arr(res.contractSurface), dataTouchpoints: arr(res.dataTouchpoints), flags: arr(res.flags), flows: arr(res.flows).length ? arr(res.flows) : arr(j.flows) },
    map: hasMap ? j.map : undefined, files,
    ...(decisions.data.length ? { decisions: decisions.data } : {}),
  };
}

export function detailFile(report: Report, map: SystemMap, node: MapNode): FileDiff | undefined {
  const file = report.files.find((f) => f.path === node.file);
  if (!file) return;
  const starts = map.nodes.filter((n) => n.file === node.file && n.line !== undefined).map((n) => n.line!).sort((a, b) => a - b);
  const from = node.line ?? 0, to = (starts.find((line) => line > from) ?? Infinity) - 1;
  const hunks = file.hunks.filter((h) => {
    const end = h.newStart + h.lines.filter((line) => line[0] !== "-").length - 1;
    return end >= from && h.newStart <= to;
  });
  return { ...file, hunks: hunks.length ? hunks : file.hunks };
}

export function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
