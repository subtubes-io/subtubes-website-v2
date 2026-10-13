import type { DesignContent } from "./designs";

export type LegendEntry = NonNullable<DesignContent["legend"]>["meanings"][number];
export const legendKey = (entry: Omit<LegendEntry, "text">) => `${entry.kind}:${entry.kind === "line" ? entry.style ?? "solid" : ""}:${entry.color?.toLowerCase() ?? "default"}`;

export function legendEntries(content: DesignContent): LegendEntry[] {
  const entries = new Map<string, LegendEntry>();
  const meanings = new Map(content.legend?.meanings.map((item) => [legendKey(item), item.text]));
  const add = (entry: LegendEntry) => {
    const key = legendKey(entry);
    if (entries.has(key)) return;
    entries.set(key, { ...entry, text: meanings.get(key) ?? "" });
  };
  for (const link of content.links) {
    if (link.color || link.style === "dashed") add({ kind: "line", style: link.style ?? "solid", ...(link.color ? { color: link.color.toLowerCase() } : {}), text: "" });
  }
  for (const node of content.nodes) if (node.color) add({ kind: "node", color: node.color.toLowerCase(), text: "" });
  return [...entries.values()];
}

export const LEGEND_WIDTH = 360;
export function legendHeight(content: DesignContent): number {
  const entries = legendEntries(content);
  return 176 + entries.reduce((height, entry) => height + Math.max(64, 32 + entry.text.split("\n").reduce((lines, text) => lines + Math.max(1, Math.ceil(text.length / 28)), 0) * 22), 0);
}

export function setLegendMeaning(content: DesignContent, entry: LegendEntry, text: string): DesignContent {
  if (!content.legend) throw new Error("Add a legend before defining its meanings.");
  const key = legendKey(entry);
  return { ...content, legend: { ...content.legend, meanings: [...content.legend.meanings.filter((item) => legendKey(item) !== key), { ...entry, text }] } };
}
