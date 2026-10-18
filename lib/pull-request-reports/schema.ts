import { z } from "zod";

// The pull-request report document and the publish request, as the desktop app defines them
// (Subtubes desktop: src/pullRequests/bundle.ts, src/components/diagram/schema.ts, shared/scenarioSchema.ts and
// src/pullRequests/remote/contract.ts). Every object is strict: a key that is not listed is refused, never ignored.
// A released document version is frozen; a new version adds a schema here and its number to ACCEPTED_SCHEMA_VERSIONS.

export const ACCEPTED_SCHEMA_VERSIONS = [2];

export const LIMITS = {
  // The whole request body, as sent. Vercel Functions refuse a body over 4.5 MB before any code runs.
  maxBodyBytes: 4_250_000,
  // The app's own limits, enforced here too because the app's checks are not trusted.
  maxCommits: 100,
  maxFiles: 300,
  maxHeadBytes: 400_000,
  maxPathLength: 4096,
  // Deepest JSON nesting accepted anywhere in the body (scenario conditions are the only recursive part).
  maxDepth: 64,
};

export const BUNDLE_KIND = "subtubes-pull-request-report";

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const iso = z.iso.datetime();
const id = z.string().min(1);
const fileStatus = z.enum(["added", "modified", "deleted"]);
const severity = z.enum(["high", "medium", "low"]);
const count = z.number().int().nonnegative();
const stat = { additions: count, deletions: count };
const titledText = z.strictObject({ title: z.string(), body: z.string() });
const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

// ---- the design: a diagram and its scenarios ----

const layer = z.enum(["ui", "runtime", "tools", "domain"]);
const coordinate = z.number().finite();
const dimension = z.number().finite().positive();

const diagramGroup = z.strictObject({
  id, title: z.string().min(1), layer, x: coordinate, y: coordinate, w: dimension, h: dimension,
});
const diagramNode = z.strictObject({
  id, title: z.string().min(1), layer, x: coordinate, y: coordinate, w: dimension, h: dimension, body: z.string(),
});
const diagramEdge = z.strictObject({
  id, from: id, to: id, label: z.string(), dashed: z.boolean().optional(), optional: z.boolean().optional(),
});

function duplicates(ids: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of ids) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export const diagramSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    groups: z.array(diagramGroup),
    nodes: z.array(diagramNode),
    edges: z.array(diagramEdge),
  })
  .superRefine((diagram, ctx) => {
    for (const key of ["groups", "nodes", "edges"] as const) {
      for (const repeated of duplicates(diagram[key].map((item) => item.id))) {
        ctx.addIssue({ code: "custom", path: [key], message: `Duplicate ${key} id "${repeated}"` });
      }
    }
    const nodeIds = new Set(diagram.nodes.map((node) => node.id));
    diagram.edges.forEach((edge, index) => {
      for (const end of ["from", "to"] as const) {
        if (!nodeIds.has(edge[end])) {
          ctx.addIssue({ code: "custom", path: ["edges", index, end], message: `Edge "${edge.id}" references unknown node "${edge[end]}"` });
        }
      }
    });
  });

const primitive = z.union([z.string(), z.number(), z.boolean()]);
const valuePath = z.string().regex(/^(input|state)\.[\w]+$/, "Use input.<name> or state.<name>");
const outcome = z.enum(["success", "failure", "blocked"]);

type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { path: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "truthy"; value?: string | number | boolean | (string | number | boolean)[] };

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(condition) }),
    z.strictObject({ any: z.array(condition) }),
    z.strictObject({ not: condition }),
    z.strictObject({
      path: valuePath,
      op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "truthy"]),
      value: z.union([primitive, z.array(primitive)]).optional(),
    }),
  ]),
);

const scenarioEnd = z.strictObject({ outcome, message: z.string().min(1) });

const scenarioEffect = z.union([
  z.strictObject({ set: id, value: primitive }),
  z.strictObject({ set: id, add: z.number() }),
  z.strictObject({
    set: id,
    derive: z.strictObject({
      from: valuePath,
      rules: z.array(z.strictObject({ contains: z.array(z.string().min(1)).min(1), value: primitive })),
      default: primitive,
    }),
    ai: z.boolean().optional(),
  }),
]);

const scenarioTransition = z
  .strictObject({ to: id.optional(), end: scenarioEnd.optional(), when: condition.optional(), label: z.string().optional() })
  .refine((t) => (t.to !== undefined) !== (t.end !== undefined), 'A branch needs exactly one of "to" or "end"');

const scenarioStep = z.strictObject({
  node: id,
  title: z.string().min(1),
  detail: z.string().optional(),
  effects: z.array(scenarioEffect).optional(),
  calls: z
    .array(z.strictObject({ to: id, title: z.string().min(1), detail: z.string().optional(), when: condition.optional() }))
    .optional(),
  next: z.array(scenarioTransition).optional(),
  end: scenarioEnd.optional(),
});

const scenarioInput = z.strictObject({
  name: z.string().regex(/^\w+$/),
  label: z.string().min(1),
  type: z.enum(["text", "number", "boolean", "select"]),
  default: primitive,
  options: z.array(z.string()).optional(),
  help: z.string().optional(),
  fromChat: z.boolean().optional(),
});

export const scenarioSchema = z
  .strictObject({
    id,
    title: z.string().min(1),
    description: z.string(),
    triggers: z.array(z.string().min(1)).optional(),
    inputs: z.array(scenarioInput),
    presets: z.array(z.strictObject({ name: z.string().min(1), values: z.record(z.string(), primitive) })).optional(),
    initialState: z.record(z.string(), primitive).optional(),
    start: id,
    steps: z.record(z.string(), scenarioStep),
  })
  .superRefine((scenario, ctx) => {
    const stepIds = new Set(Object.keys(scenario.steps));
    if (!stepIds.has(scenario.start)) {
      ctx.addIssue({ code: "custom", path: ["start"], message: `Start step "${scenario.start}" is not defined` });
    }
    for (const [stepId, step] of Object.entries(scenario.steps)) {
      step.next?.forEach((transition, index) => {
        if (transition.to !== undefined && !stepIds.has(transition.to)) {
          ctx.addIssue({ code: "custom", path: ["steps", stepId, "next", index, "to"], message: `Unknown step "${transition.to}"` });
        }
      });
    }
  });

// ---- the report document, version 2 ----

const commitReport = z.strictObject({
  id,
  commit: sha,
  title: z.string(),
  features: z.array(titledText),
  issues: z.array(z.strictObject({ severity, title: z.string(), body: z.string() })),
});

const hunk = z.strictObject({
  oldStart: count,
  newStart: count,
  rows: z.array(z.strictObject({ kind: z.enum(["context", "added", "removed"]), text: z.string() })),
});

const discussionComment = z.strictObject({
  path: z.string().max(LIMITS.maxPathLength),
  lines: z.strictObject({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    side: z.enum(["new", "old"]),
  }),
  excerpt: z.string(),
  body: z.string(),
});

export const bundleSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    kind: z.literal(BUNDLE_KIND),
    exportedAt: iso,
    report: z.strictObject({
      id,
      title: z.string(),
      overview: z.string(),
      themes: z.array(titledText),
      risks: z.array(z.strictObject({ severity, title: z.string(), body: z.string() })),
      createdAt: iso,
      draftedBy: z.enum(["assistant", "manual"]),
    }),
    branch: z.strictObject({
      name: z.string().min(1),
      base: z.strictObject({ branch: z.string().min(1), sha }),
      range: z.strictObject({ startSha: sha, headSha: sha, commitCount: z.number().int().positive() }),
    }),
    summary: z.strictObject({
      commitCount: z.number().int().positive(),
      fileCount: count,
      ...stat,
      authors: z.array(z.string()),
    }),
    commits: z
      .array(
        z.strictObject({
          sha,
          subject: z.string(),
          author: z.string(),
          committedAt: iso,
          files: z.array(z.strictObject({ path: z.string().max(LIMITS.maxPathLength), status: fileStatus, ...stat })),
          reportId: z.string().nullable(),
        }),
      )
      .min(1)
      .max(LIMITS.maxCommits),
    files: z
      .array(
        z.strictObject({
          path: z.string().min(1).max(LIMITS.maxPathLength),
          status: fileStatus,
          ...stat,
          language: z.string(),
          hunks: z.array(hunk),
          head: z
            .string()
            .nullable()
            .refine((text) => text === null || utf8Bytes(text) <= LIMITS.maxHeadBytes, `A file's text may not be over ${LIMITS.maxHeadBytes} bytes`),
        }),
      )
      .max(LIMITS.maxFiles),
    commitReports: z.array(commitReport),
    design: z.strictObject({
      designId: id,
      designName: z.string(),
      revision: count,
      headSha: sha,
      diagram: diagramSchema,
      scenarios: z.array(scenarioSchema),
    }),
    discussion: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string(), comments: z.array(discussionComment) })),
  })
  .superRefine((bundle, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const { branch, summary, commits, files, commitReports, design } = bundle;

    if (branch.range.commitCount !== commits.length) issue(["branch", "range", "commitCount"], "Does not match the number of commits");
    if (summary.commitCount !== commits.length) issue(["summary", "commitCount"], "Does not match the number of commits");
    if (summary.fileCount !== files.length) issue(["summary", "fileCount"], "Does not match the number of files");
    if (summary.additions !== files.reduce((n, f) => n + f.additions, 0)) issue(["summary", "additions"], "Does not match the files");
    if (summary.deletions !== files.reduce((n, f) => n + f.deletions, 0)) issue(["summary", "deletions"], "Does not match the files");
    if (design.headSha !== branch.range.headSha) issue(["design", "headSha"], "Is not the head of the branch");

    for (const path of duplicates(files.map((f) => f.path))) issue(["files"], `Duplicate file "${path}"`);
    for (const sha of duplicates(commits.map((c) => c.sha))) issue(["commits"], `Duplicate commit "${sha}"`);
    for (const reportId of duplicates(commitReports.map((r) => r.id))) issue(["commitReports"], `Duplicate report id "${reportId}"`);
    for (const scenarioId of duplicates(design.scenarios.map((s) => s.id))) issue(["design", "scenarios"], `Duplicate scenario id "${scenarioId}"`);

    const commitShas = new Set(commits.map((c) => c.sha));
    commitReports.forEach((report, index) => {
      if (!commitShas.has(report.commit)) issue(["commitReports", index, "commit"], "Is not one of the commits");
    });
    const reportIds = new Set(commitReports.map((r) => r.id));
    commits.forEach((commit, index) => {
      if (commit.reportId !== null && !reportIds.has(commit.reportId)) issue(["commits", index, "reportId"], "Is not one of the commit reports");
    });
  });

export type Bundle = z.infer<typeof bundleSchema>;

// ---- the publish request ----

// The git remote as the app sends it: with credentials already removed. The website removes any that remain (see sanitizeRemote).
const remoteUrl = z
  .string()
  .max(500)
  .refine(
    (value) =>
      (/^(https?|ssh|git):\/\/[^\s/?#]+/i.test(value) && !/\s/.test(value) && URL.canParse(value)) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(value),
    "Is not a git remote address",
  );

export const repositorySchema = z.strictObject({
  name: z.string().min(1).max(200),
  remote: remoteUrl.nullable(),
});

export const publishRequestSchema = z.strictObject({
  bundle: bundleSchema,
  repository: repositorySchema.optional(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type Repository = z.infer<typeof repositorySchema>;
