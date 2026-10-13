import { z } from "zod/v3";
import { legendKey } from "./design-legend";

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const coordinate = z.number().finite().min(0).max(20000);
export const diagramFileRef = z.object({
  file: z.string().min(1).max(4096).refine(value => !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => part === ".." || part === "." || !part) && !/^[A-Za-z]:/.test(value), "Use a repository-relative file path."),
  line: z.number().int().positive().safe().optional(),
}).strict();
const fileRefs = z.array(diagramFileRef).max(30).optional().describe("Repository-relative changed-file references; report viewers open these in the existing diff drawer.");
export const designGroup = z.object({
  id, title: z.string().trim().min(1).max(200), comment: z.string().max(20000),
  fileRefs,
  x: coordinate, y: coordinate, width: z.number().finite().min(300).max(20000),
  height: z.number().finite().min(220).max(20000),
}).strict();
export const designNodeStatus = z.enum(["in-progress", "completed"]);
export type DesignNodeStatus = z.infer<typeof designNodeStatus>;
export const designNode = z.object({
  id, title: z.string().trim().min(1).max(200), comment: z.string().max(20000),
  fileRefs,
  kind: z.literal("context").optional().describe('Set to "context" for a standalone context/description node. Context nodes document the system, render Markdown like other nodes, must have groupId null (they live outside lanes and groups, in swimlane and system diagrams alike) and cannot be link endpoints. Omit for ordinary nodes.'),
  status: designNodeStatus.optional().describe('Implementation status shown as an icon in the node header: "in-progress" or "completed". Omit when not started; nothing is shown. Not allowed on context nodes.'),
  groupId: id.nullable(), x: coordinate, y: coordinate,
  width: z.number().finite().min(160).max(20000).optional().describe("Node width; defaults to 240."),
  height: z.number().finite().min(100).max(20000).optional().describe("Node height; defaults to 144."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex node border color; omitted uses the theme default."),
}).strict();
export const designLink = z.object({
  id, from: id, to: id, label: z.string().max(500),
  style: z.enum(["solid", "dashed"]).optional().describe("Line style; defaults to solid."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Hex line color; omitted uses the theme accent."),
}).strict();
export const designContent = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["system", "swimlane"]),
  orientation: z.enum(["horizontal", "vertical"]).optional().describe("Swimlane direction: horizontal rows (default) or vertical columns. Ignored for system diagrams."),
  description: z.string().max(20000),
  groups: z.array(designGroup).max(100),
  nodes: z.array(designNode).max(500),
  links: z.array(designLink).max(1000),
  legend: z.object({
    x: coordinate, y: coordinate,
    meanings: z.array(z.object({
      kind: z.enum(["line", "node"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      style: z.enum(["solid", "dashed"]).optional(),
      text: z.string().max(2000),
    }).strict()).max(1500),
  }).strict().optional().describe("Standalone movable legend card. Meaning entries describe unique line style/color pairs or node border colors; omitted color means theme default."),
}).strict().superRefine((design, context) => {
  if (new TextEncoder().encode(JSON.stringify(design)).byteLength > 900000) context.addIssue({ code: "custom", message: "Design content exceeds 900 KB. Shorten comments or split the diagram." });
  for (const field of ["groups", "nodes", "links"] as const) {
    const ids = new Set<string>();
    design[field].forEach((entry, index) => {
      if (ids.has(entry.id)) context.addIssue({ code: "custom", path: [field, index, "id"], message: "Duplicate ID." });
      ids.add(entry.id);
    });
  }
  const groups = new Set(design.groups.map((group) => group.id));
  const nodes = new Set(design.nodes.map((node) => node.id));
  const meanings = new Set<string>();
  design.legend?.meanings.forEach((entry, index) => {
    const key = legendKey(entry);
    if (meanings.has(key)) context.addIssue({ code: "custom", path: ["legend", "meanings", index], message: "Duplicate legend variation." });
    meanings.add(key);
    if (entry.kind === "node" && (!entry.color || entry.style)) context.addIssue({ code: "custom", path: ["legend", "meanings", index], message: "Node legend entries require a color and cannot have a line style." });
  });
  const contextNodes = new Set(design.nodes.filter((node) => node.kind === "context").map((node) => node.id));
  design.nodes.forEach((node, index) => {
    if (node.kind === "context") {
      if (node.groupId !== null) context.addIssue({ code: "custom", path: ["nodes", index, "groupId"], message: "Context nodes live outside lanes and groups; set groupId to null." });
      if (node.status) context.addIssue({ code: "custom", path: ["nodes", index, "status"], message: "Context nodes do not have an implementation status." });
      return;
    }
    if (node.groupId !== null && !groups.has(node.groupId)) context.addIssue({ code: "custom", path: ["nodes", index, "groupId"], message: "Unknown group or lane." });
    if (design.kind === "swimlane" && node.groupId === null) context.addIssue({ code: "custom", path: ["nodes", index, "groupId"], message: "Swimlane nodes require a lane." });
  });
  design.links.forEach((link, index) => {
    if (!nodes.has(link.from) || !nodes.has(link.to)) context.addIssue({ code: "custom", path: ["links", index], message: "Link endpoints must reference existing nodes." });
    if (contextNodes.has(link.from) || contextNodes.has(link.to)) context.addIssue({ code: "custom", path: ["links", index], message: "Context nodes cannot be linked." });
    if (link.from === link.to) context.addIssue({ code: "custom", path: ["links", index], message: "Self-links are not supported." });
  });
});
export type DesignContent = z.infer<typeof designContent>;
export type DesignNode = z.infer<typeof designNode>;
export type DesignGroup = z.infer<typeof designGroup>;
export type DesignLink = z.infer<typeof designLink>;
export const savedDesign = z.object({
  id, revision: z.number().int().positive().safe(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  content: designContent,
}).strict();
export type SavedDesign = z.infer<typeof savedDesign>;
export type DesignSummary = Omit<SavedDesign, "content"> & { name: string; kind: DesignContent["kind"]; description: string; nodes: number; groups: number };
export const designRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("read"), id }).strict(),
  z.object({ action: z.literal("create"), content: designContent }).strict(),
  z.object({ action: z.literal("update"), id, expectedRevision: z.number().int().positive().safe(), content: designContent }).strict(),
  z.object({ action: z.literal("delete"), id, expectedRevision: z.number().int().positive().safe() }).strict(),
]);
export type DesignRequest = z.infer<typeof designRequest>;
export interface DesignResult { designs: DesignSummary[]; design?: SavedDesign }

export function emptyDesign(name: string, kind: DesignContent["kind"], orientation: "horizontal" | "vertical" = "horizontal"): DesignContent {
  if (kind === "system") return { name, kind, description: "", nodes: [], links: [], groups: [] };
  const vertical = orientation === "vertical";
  return { name, kind, orientation, description: "", nodes: [], links: [], groups: [
    { id: "lane-1", title: "Lane 1", comment: "", x: 40, y: 40, width: vertical ? 320 : 1100, height: vertical ? 700 : 260 },
  ] };
}
