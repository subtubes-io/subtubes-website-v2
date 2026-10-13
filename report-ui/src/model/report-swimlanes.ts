import { z } from "zod/v3";
import { designContent } from "./designs";
import { attachmentHash } from "./attachments";

export const reportSwimlanes = z.array(z.object({
  id: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  content: designContent,
  source: z.object({
    designId: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
    revision: z.number().int().positive().safe(),
    name: z.string().trim().min(1).max(200),
    snapshotAt: z.string().datetime(),
  }).strict().optional().describe("Set when the diagram is a frozen copy of a saved design."),
  preview: attachmentHash.optional().describe("A PNG picture of the diagram, made by the app and stored as an attachment."),
}).strict()).max(20).superRefine((diagrams, context) => {
  const ids = new Set<string>();
  diagrams.forEach((diagram, index) => {
    if (ids.has(diagram.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate swimlane diagram ID." });
    ids.add(diagram.id);
  });
  if (new TextEncoder().encode(JSON.stringify(diagrams)).byteLength > 2_000_000) {
    context.addIssue({ code: "custom", message: "Report diagrams exceed 2 MB. Remove a diagram or shorten comments." });
  }
});
export type ReportSwimlane = z.infer<typeof reportSwimlanes>[number];

/** Diagrams a coding agent draws itself. The normal path is to pick saved designs after the report exists (attach_design_to_report). */
export const SWIMLANES_DESCRIPTION = "OPTIONAL and usually omitted: the reviewer attaches saved Designs diagrams to the report after it is generated (they become frozen snapshots), so do not redraw work that exists in Designs. Pass this only when no saved design covers the change, as [{id, content}] in the Designs content format (kind swimlane or system) with verified steps and links and file/line evidence; never invent steps. Replaces the report's agent-drawn diagrams.";
