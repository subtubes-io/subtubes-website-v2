import { z } from "zod/v3";
import { lineAnchor, lineSide } from "./anchors";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1).max(20000);
const label = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime();

export const decisionKind = z.enum(["direction", "tradeoff", "override", "risk-accepted", "scope", "deferred"])
  .describe("direction: a person chose the approach; tradeoff: chose between alternatives; override: corrected the AI; risk-accepted: knowingly accepted a risk or debt; scope: set or limited scope; deferred: intentionally postponed work.");
export type DecisionKind = z.infer<typeof decisionKind>;
export const decisionMadeBy = z.enum(["human", "agent"]).describe("human: a person made this call. agent: the AI had to guess and no person was asked; it is shown as an assumption for the reviewer to confirm.");
export const decisionStatus = z.enum(["active", "superseded"]);

/** Stored anchors: a saved diff line, a whole file, or a node of an embedded report diagram. */
export const decisionAnchor = z.union([
  z.object({ type: z.literal("line"), anchor: lineAnchor }).strict(),
  z.object({ type: z.literal("file"), file: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("node"), diagramId: id, nodeId: id }).strict(),
]);
export type DecisionAnchor = z.infer<typeof decisionAnchor>;

export const decisionSource = z.object({
  kind: z.enum(["chat", "review", "ticket", "other"]).describe("Where the decision came from."),
  quote: z.string().trim().min(1).max(500).optional().describe("The person's own words. Required when an agent records a human decision."),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();
const alternative = z.object({ option: z.string().trim().min(1).max(500), whyNot: z.string().trim().max(2000).default("") }).strict();

export const decision = z.object({
  id, revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200), kind: decisionKind,
  decision: text, rationale: z.string().trim().max(20000),
  alternatives: z.array(alternative).max(10),
  revisitWhen: z.string().trim().min(1).max(2000).optional(),
  madeBy: decisionMadeBy, recordedBy: z.enum(["user", "agent"]), agent: label.optional(),
  source: decisionSource,
  confirmed: z.boolean(), confirmedAt: timestamp.optional(),
  status: decisionStatus,
  anchors: z.array(decisionAnchor).max(20),
  createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((item, ctx) => {
  if (item.recordedBy === "agent" && !item.agent) ctx.addIssue({ code: "custom", message: "Agent-recorded decisions need an agent label." });
  if (item.recordedBy === "user" && item.agent) ctx.addIssue({ code: "custom", message: "User-recorded decisions cannot have an agent label." });
  if (item.recordedBy === "user" && item.madeBy !== "human") ctx.addIssue({ code: "custom", message: "A decision recorded by a person is a human decision." });
  if (item.recordedBy === "agent" && item.madeBy === "human" && !item.source.quote) ctx.addIssue({ code: "custom", path: ["source", "quote"], message: "Quote the person, or record this as an agent assumption (madeBy: agent)." });
  if (item.madeBy === "agent" && item.source.quote) ctx.addIssue({ code: "custom", path: ["source", "quote"], message: "An agent assumption has no human quote; use madeBy: human if a person said it." });
});
export const decisions = z.array(decision).max(500).superRefine((items, ctx) => {
  if (new Set(items.map((item) => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "Duplicate decision ID." });
});
export type Decision = z.infer<typeof decision>;

/** Anchors as supplied by callers; the service resolves them against the saved report. */
export const decisionAnchorInput = z.union([
  z.object({ type: z.literal("line"), file: z.string().min(1), side: lineSide, line: z.number().int().positive(), expectedText: z.string().describe("Exact text of that line in the saved diff, without the +/-/space prefix.") }).strict(),
  z.object({ type: z.literal("file"), file: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("node"), diagramId: id.describe("ID of an embedded report swimlane diagram."), nodeId: id }).strict(),
]);
export type DecisionAnchorInput = z.infer<typeof decisionAnchorInput>;

const draft = {
  title: z.string().trim().min(1).max(200).describe("Short label, such as 'Keep the legacy default'."),
  kind: decisionKind, decision: text.describe("What was decided. Markdown."),
  rationale: z.string().trim().max(20000).default("").describe("Why. Markdown."),
  alternatives: z.array(alternative).max(10).default([]).describe("Options that were rejected and why."),
  revisitWhen: z.string().trim().min(1).max(2000).optional().describe("What would make this worth reconsidering."),
  anchors: z.array(decisionAnchorInput).max(20).default([]).describe("Where it applies: saved diff lines, files or diagram nodes. Omit for a report-wide decision."),
};
export const humanDecisionDraft = z.object(draft).strict();
export type HumanDecisionDraft = z.infer<typeof humanDecisionDraft>;
/** Shape an agent supplies, both from publish_report and record_decision. */
export const agentDecisionInput = z.object({ ...draft, madeBy: decisionMadeBy, source: decisionSource }).strict();
export type AgentDecisionInput = z.infer<typeof agentDecisionInput>;

export const decisionScope = { projectId: id, reportId: id };
const target = { ...decisionScope, decisionId: id, expectedRevision: z.number().int().positive() };
export const recordDecisionArgs = z.object({ ...decisionScope, agent: label, ...agentDecisionInput.shape }).strict();
export const supersedeDecisionArgs = z.object({ ...target, agent: label }).strict();
export const decisionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ...decisionScope }).strict(),
  z.object({ action: z.literal("create"), ...decisionScope, ...draft }).strict(),
  recordDecisionArgs.extend({ action: z.literal("agentRecord") }),
  z.object({ action: z.literal("edit"), ...target, ...humanDecisionDraft.partial().shape, revisitWhen: z.string().trim().max(2000).optional().describe("Empty string clears it."), madeBy: decisionMadeBy.optional() }).strict(),
  z.object({ action: z.literal("confirm"), ...target, confirmed: z.boolean() }).strict(),
  z.object({ action: z.literal("setStatus"), ...target, status: decisionStatus }).strict(),
  z.object({ action: z.literal("remove"), ...target }).strict(),
  supersedeDecisionArgs.extend({ action: z.literal("agentSupersede") }),
]);
export type DecisionRequest = z.infer<typeof decisionRequest>;
export type DecisionMutation = Exclude<DecisionRequest, { action: "list" }>;
type WithoutScope<T> = T extends unknown ? Omit<T, "projectId" | "reportId"> : never;
export type DecisionChange = WithoutScope<DecisionMutation>;
export interface DecisionResult { projectId: string; reportId: string; repoRoot?: string; base: string; head: string; decisions: Decision[] }

export const needsConfirmation = (item: Decision) => item.status === "active" && !item.confirmed && (item.madeBy === "agent" || item.recordedBy === "agent");
export const assumptions = (items: Decision[]) => items.filter((item) => item.status === "active" && item.madeBy === "agent");
