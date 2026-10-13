import { z } from "zod/v3";
import type { Flag, IntentGroup as Group } from "./types";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const scope = { projectId: id, reportId: id };
const index = z.number().int().nonnegative();

export const MAX_TITLE = 200, MAX_TEXT = 20000, MAX_FLAG = 2000;

/** Edits a person makes to the written parts of a living report. The text is Markdown. */
export const reportTextRequest = z.discriminatedUnion("target", [
  z.object({ target: z.literal("title"), ...scope, text: z.string().trim().min(1).max(MAX_TITLE) }).strict(),
  z.object({ target: z.literal("narrative"), ...scope, text: z.string().trim().max(MAX_TEXT) }).strict(),
  z.object({ target: z.literal("group"), ...scope, index, text: z.string().trim().min(1).max(MAX_TEXT) }).strict(),
  z.object({ target: z.literal("flag"), ...scope, index, text: z.string().trim().min(1).max(MAX_FLAG) }).strict(),
]);
export type ReportTextRequest = z.input<typeof reportTextRequest>;
type WithoutScope<T> = T extends unknown ? Omit<T, "projectId" | "reportId"> : never;
/** What the app sends: the project and report come from the open report. */
export type ReportTextChange = WithoutScope<ReportTextRequest>;
export interface ReportTextResult { projectId: string; reportId: string; title: string; narrative: string; groups: Group[]; flags: Flag[] }

/** Edits are remembered by what they describe, so an agent update that regenerates the same group or flag keeps the person's wording. */
export interface ReviewerEdits { title?: string; narrative?: string; groups?: Record<string, string>; flags?: Record<string, string> }
export const groupKey = (group: Pick<Group, "kind" | "files">) => `${group.kind}:${[...group.files].sort().join("|")}`;
export const flagKey = (flag: Pick<Flag, "file" | "line" | "category">) => `${flag.category}:${flag.file}:${flag.line}`;
