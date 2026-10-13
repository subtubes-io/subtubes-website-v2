import { z } from "zod/v3";
import { attachmentHash } from "./attachments";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const label = z.string().trim().min(1).max(120);
const timestamp = z.string().datetime();

export const MAX_QA_STEPS = 100;
export const MAX_QA_NOTE = 4000;
const note = z.string().trim().max(MAX_QA_NOTE).describe("Markdown. What the tester did or saw at this step.");
const image = attachmentHash.describe("An image already stored with attach_image (or by the app).");

/** One step in the walkthrough that shows how the feature was exercised: a screenshot and/or a note. */
export const qaStep = z.object({
  id, revision: z.number().int().positive(),
  image: attachmentHash.optional(),
  note: z.string().max(MAX_QA_NOTE),
  recordedBy: z.enum(["user", "agent"]),
  agent: label.optional(),
  createdAt: timestamp, updatedAt: timestamp,
}).strict().refine((step) => !!step.image || step.note.trim().length > 0, "A QA step needs an image or a note.");
export type QaStep = z.infer<typeof qaStep>;
export const qaSteps = z.array(qaStep).max(MAX_QA_STEPS);

export const MAX_WALKTHROUGHS = 20;
const title = z.string().trim().min(1).max(120);
/** A named, ordered run of QA steps. A report can have several, for example one per flow or device. */
export const qaWalkthrough = z.object({
  id, revision: z.number().int().positive(), title, steps: qaSteps, createdAt: timestamp, updatedAt: timestamp,
}).strict();
export type QaWalkthrough = z.infer<typeof qaWalkthrough>;
export const qaWalkthroughs = z.array(qaWalkthrough).max(MAX_WALKTHROUGHS);

/** The report's walkthroughs. Reports saved with a single flat list of steps read as one walkthrough. */
export function walkthroughsOf(report: { qa?: QaStep[]; walkthroughs?: QaWalkthrough[] }): QaWalkthrough[] {
  if (report.walkthroughs) return report.walkthroughs;
  if (report.qa?.length) {
    const at = report.qa.reduce((latest, step) => (step.updatedAt > latest ? step.updatedAt : latest), report.qa[0].updatedAt);
    return [{ id: "walkthrough", revision: 1, title: "Walkthrough", steps: report.qa, createdAt: report.qa[0].createdAt, updatedAt: at }];
  }
  return [];
}

export const qaScope = { projectId: id, reportId: id };
const inWalkthrough = { ...qaScope, walkthroughId: id };
const target = { ...inWalkthrough, stepId: id, expectedRevision: z.number().int().positive() };
const walkthroughTarget = { ...inWalkthrough, expectedRevision: z.number().int().positive() };

export const recordQaStepArgs = z.object({
  ...qaScope, agent: label, image: image.optional(), note: note.default(""),
  walkthrough: title.optional().describe("Title of the walkthrough to add the step to. It is created when it does not exist; omit to use the first one."),
}).strict();

export const qaRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ...qaScope }).strict(),
  z.object({ action: z.literal("addWalkthrough"), ...qaScope, title }).strict(),
  z.object({ action: z.literal("renameWalkthrough"), ...walkthroughTarget, title }).strict(),
  z.object({ action: z.literal("removeWalkthrough"), ...walkthroughTarget }).strict(),
  z.object({ action: z.literal("add"), ...inWalkthrough, image: image.optional(), note: note.default("") }).strict(),
  recordQaStepArgs.extend({ action: z.literal("agentRecord") }),
  z.object({ action: z.literal("edit"), ...target, note: note.optional(), image: image.nullable().optional().describe("null removes the image.") }).strict(),
  z.object({ action: z.literal("move"), ...target, toIndex: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("remove"), ...target }).strict(),
]);
export type QaRequest = z.input<typeof qaRequest>;
export type QaMutation = Exclude<QaRequest, { action: "list" }>;
type WithoutScope<T> = T extends unknown ? Omit<T, "projectId" | "reportId"> : never;
/** What the app sends: the project and report come from the open report. */
export type QaChange = WithoutScope<QaMutation>;
export interface QaResult { projectId: string; reportId: string; walkthroughs: QaWalkthrough[] }
