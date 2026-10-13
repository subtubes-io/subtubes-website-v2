import { z } from "zod/v3";

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
export const DesignRefSchema = z.object({
  designId: id.describe("Live Designs ID from list_designs, not a report map node ID"),
  nodeId: id.optional().describe("Optional node ID in that live diagram"),
  label: z.string().trim().min(1).max(200).optional(),
}).strict();
export const DesignRefsSchema = z.array(DesignRefSchema).max(50);

export function dedupeDesignRefs(refs: z.infer<typeof DesignRefsSchema>) {
  return [...new Map(refs.map((ref) => [JSON.stringify([ref.designId, ref.nodeId ?? null]), ref])).values()];
}
