import { z } from "zod/v3";
import type { ReportSwimlane } from "./report-swimlanes";
import { attachmentHash } from "./attachments";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const reportDesignScope = { projectId: id, reportId: id };

export const attachDesignArgs = z.object({ ...reportDesignScope, designId: id.describe("Exact design ID from list_designs.") }).strict();

export const reportDesignRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ...reportDesignScope }).strict(),
  attachDesignArgs.extend({ action: z.literal("attach") }),
  z.object({ action: z.literal("remove"), ...reportDesignScope, diagramId: id }).strict(),
  z.object({ action: z.literal("preview"), ...reportDesignScope, diagramId: id, image: attachmentHash }).strict(),
]);
export type ReportDesignRequest = z.infer<typeof reportDesignRequest>;
export type ReportDesignChange = ReportDesignRequest extends infer T ? T extends { action: "list" } ? never : T extends unknown ? Omit<T, "projectId" | "reportId"> : never : never;
export interface ReportDesignResult { projectId: string; reportId: string; diagrams: ReportSwimlane[]; attached?: ReportSwimlane }
