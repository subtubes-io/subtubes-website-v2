import { z } from "zod/v3";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const path = z.string().min(1).max(1000);

/** The commit a snapshot is bound to. Optional: a snapshot can exist without one. */
export const commitBinding = z.object({
  sha, shortSha: z.string().min(7).max(12), subject: z.string().max(500),
  author: z.string().max(200).optional(), authoredAt: z.string().max(60).optional(), branch: z.string().max(250).optional(),
  /** Files of the report that the commit includes, and those it does not (a partial commit). */
  committedFiles: z.array(path).max(5000), uncommittedFiles: z.array(path).max(5000),
}).strict();
export type CommitBinding = z.infer<typeof commitBinding>;

export interface ReportSnapshotMeta { id: string; reportId: string; number: number; takenAt: string; note?: string; commit?: CommitBinding }

export const snapshotScope = { projectId: id, reportId: id };
const number = z.number().int().positive();

export const snapshotRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ...snapshotScope }).strict(),
  z.object({ action: z.literal("read"), ...snapshotScope, number }).strict(),
  z.object({ action: z.literal("delete"), ...snapshotScope, number }).strict(),
  z.object({ action: z.literal("status"), ...snapshotScope }).strict(),
  z.object({
    action: z.literal("create"), ...snapshotScope, note: z.string().trim().max(2000).optional(),
    commit: z.object({ message: z.string().trim().min(1).max(5000), files: z.array(path).min(1).max(5000) }).strict().optional(),
    bindHead: z.boolean().optional(),
  }).strict(),
]).refine((request) => request.action !== "create" || !(request.commit && request.bindHead), "Choose either a new commit or binding to HEAD.");
export type SnapshotRequest = z.input<typeof snapshotRequest>;

export type FileDrift = "same" | "changed" | "new";
export interface SnapshotFileStatus { path: string; status: "modified" | "added" | "deleted" | "renamed" | "untracked"; oldPath?: string; drift: FileDrift }
export interface SnapshotStatus {
  /** False when the project has no repository folder or it cannot be read. */
  repository: boolean; reason?: string;
  branch?: string; detached?: boolean; operation?: string;
  files: SnapshotFileStatus[];
  /** Files in the report that no longer differ in the working tree. */
  missing: string[];
  /** Set when HEAD's own change matches the report, so the snapshot can be bound to it. */
  headMatch?: { sha: string; shortSha: string; subject: string };
}

export interface SnapshotResult {
  projectId: string; reportId: string; snapshots: ReportSnapshotMeta[];
  /** The full saved report as it was when the snapshot was taken (read). */
  content?: unknown;
  status?: SnapshotStatus;
  created?: ReportSnapshotMeta;
}
