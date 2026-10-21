import { z } from "zod";
import { REPOSITORY_KEY_PATTERN, repositoryKey } from "./repository-key";

// The pull-request report document and the publish request, as the desktop app defines them
// (Subtubes desktop: src/pullRequests/bundle.ts, src/components/diagram/schema.ts, shared/scenarioSchema.ts and
// src/pullRequests/remote/contract.ts). Every object is strict: a key that is not listed is refused, never ignored.
// A released document version is frozen; a new version adds a schema here and its number to ACCEPTED_SCHEMA_VERSIONS.

// A report holds no code (version 3): its files are listed with their status and counts, and the diffs are read from each person's own copy of
// the repository. Version 2 carried them; the website no longer takes it, but still returns what it stored.
export const ACCEPTED_SCHEMA_VERSIONS = [3, 4];

export const LIMITS = {
  // The whole request body, as sent. Vercel Functions refuse a body over 4.5 MB before any code runs.
  maxBodyBytes: 4_250_000,
  // The app's own limits, enforced here too because the app's checks are not trusted.
  maxCommits: 100,
  maxFiles: 300,
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

// Version 2 of a diagram: a node, group or edge may have its own colour, and a layer is optional. A colour is a preset name
// (it follows the app's light or dark theme) or a fixed #rrggbb: the same two forms as the desktop app's shared/colors.ts.
export const COLOR_PRESETS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"] as const;
const color = z.union([z.enum(COLOR_PRESETS), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
const diagramGroupV2 = diagramGroup.extend({ layer: layer.optional(), color: color.optional() });
const diagramNodeV2 = diagramNode.extend({ layer: layer.optional(), color: color.optional() });
const diagramEdgeV2 = diagramEdge.extend({ color: color.optional() });

function duplicates(ids: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of ids) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

type DiagramParts = { groups: { id: string }[]; nodes: { id: string }[]; edges: { id: string; from: string; to: string }[] };

function checkDiagram(diagram: DiagramParts, ctx: z.RefinementCtx) {
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
}

// A diagram carries its own version. Version 1 is frozen; a report may hold either, since a person's older reports keep theirs.
const diagramV1 = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    groups: z.array(diagramGroup),
    nodes: z.array(diagramNode),
    edges: z.array(diagramEdge),
  })
  .superRefine(checkDiagram);

const diagramV2 = z
  .strictObject({
    schemaVersion: z.literal(2),
    name: z.string().min(1),
    description: z.string().optional(),
    groups: z.array(diagramGroupV2),
    nodes: z.array(diagramNodeV2),
    edges: z.array(diagramEdgeV2),
  })
  .superRefine(checkDiagram);

export const diagramSchema = z.discriminatedUnion("schemaVersion", [diagramV1, diagramV2]);

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

// ---- the report document, version 3 ----

const commitReport = z.strictObject({
  id,
  commit: sha,
  title: z.string(),
  features: z.array(titledText),
  issues: z.array(z.strictObject({ severity, title: z.string(), body: z.string() })),
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

const sectionDiscussionComment = z.strictObject({
  kind: z.literal("section"),
  sectionId: z.string().min(1),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
});

const codeDiscussionComment = z.strictObject({
  kind: z.literal("code"),
  path: z.string().max(LIMITS.maxPathLength),
  lines: z.strictObject({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    side: z.enum(["new", "old"]),
  }),
  excerpt: z.string(),
  body: z.string(),
});

const bundleFields = {
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
    .array(z.strictObject({ path: z.string().min(1).max(LIMITS.maxPathLength), status: fileStatus, ...stat, language: z.string() }))
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
};

const checkBundle = (bundle: {
  branch: z.infer<typeof bundleFields.branch>
  summary: z.infer<typeof bundleFields.summary>
  commits: z.infer<typeof bundleFields.commits>
  files: z.infer<typeof bundleFields.files>
  commitReports: z.infer<typeof bundleFields.commitReports>
  design: z.infer<typeof bundleFields.design>
}, ctx: z.RefinementCtx) => {
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
};

const discussionV3 = z.array(z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string(), comments: z.array(discussionComment) }));
const discussionV4 = z.array(z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  comments: z.array(z.discriminatedUnion("kind", [codeDiscussionComment, sectionDiscussionComment])),
}));

export const bundleSchemaV3 = z.strictObject({ schemaVersion: z.literal(3), ...bundleFields, discussion: discussionV3 }).superRefine(checkBundle);
export const bundleSchemaV4 = z.strictObject({ schemaVersion: z.literal(4), ...bundleFields, discussion: discussionV4 }).superRefine(checkBundle);
export const bundleSchema = z.discriminatedUnion("schemaVersion", [bundleSchemaV3, bundleSchemaV4]);

export type Bundle = z.infer<typeof bundleSchema>;

// ---- the publish request ----

// The git remote as the app sends it: the project's remote, with credentials already removed. The website removes any that remain (see
// sanitizeRemote) and works out the repository key from it; a remote that has no key is refused.
const remoteUrl = z
  .string()
  .max(500)
  .refine((value) => repositoryKey(value) !== null, "Is not the address of a git repository");

export const repositorySchema = z.strictObject({
  name: z.string().min(1).max(200),
  remote: remoteUrl,
});

export const publishRequestSchema = z.strictObject({
  bundle: bundleSchema,
  repository: repositorySchema,
});

// POST .../move: file the reports of one repository under another (the project's remote changed).
export const moveRequestSchema = z.strictObject({
  from: z.string().max(300).regex(REPOSITORY_KEY_PATTERN),
  to: repositorySchema,
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type MoveRequest = z.infer<typeof moveRequestSchema>;
export type Repository = z.infer<typeof repositorySchema>;
