import type { DesignContent } from "./model/designs";
import { LEGEND_WIDTH, legendHeight } from "./model/design-legend";
import { designLayout, isContextNode, isVertical, route, type Box } from "./design-layout";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const plain = (markdown: string) => markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~]+/g, "").replace(/\s+/g, " ").trim();

/** Words wrapped to lines of at most `max` characters; the last line ends with an ellipsis when text is left over. */
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(" ").filter(Boolean);
  let used = 0;
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) { out.push(line); line = ""; if (out.length === lines) break; }
    line = line ? `${line} ${word}` : word;
    used++;
  }
  if (out.length < lines && line) out.push(line);
  if (used < words.length || out.length > lines) { out.length = Math.min(out.length, lines); out[out.length - 1] = `${out[out.length - 1].slice(0, Math.max(1, max - 1)).trimEnd()}…`; }
  return out.slice(0, lines);
}

const INK = "#1d2939", MUTED = "#667085", LANE = "#f2f4f7", LANE_LINE = "#d0d5dd";

/** The diagram as an SVG picture, drawn from its content alone: lanes or groups, steps with their titles and a line of detail, and the links between them. */
export function designSvg(content: DesignContent): { svg: string; width: number; height: number } {
  const layout = designLayout(content);
  const boxes: Box[] = [...layout.groups.values(), ...layout.nodes.values()];
  if (content.legend) boxes.push({ x: content.legend.x, y: content.legend.y, w: LEGEND_WIDTH, h: legendHeight(content) });
  const pad = 32;
  const minX = Math.min(...boxes.map((box) => box.x)) - pad, minY = Math.min(...boxes.map((box) => box.y)) - pad;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w)) + pad, maxY = Math.max(...boxes.map((box) => box.y + box.h)) + pad;
  const width = Math.max(1, Math.round(maxX - minX)), height = Math.max(1, Math.round(maxY - minY));
  const vertical = isVertical(content);
  const parts: string[] = [];
  for (const group of content.groups) {
    const box = layout.groups.get(group.id)!;
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="${LANE}" stroke="${LANE_LINE}"/>`);
    parts.push(`<text x="${box.x + 16}" y="${box.y + 26}" font-size="15" font-weight="700" fill="${INK}">${escape(wrap(group.title, Math.floor((vertical ? box.w : 160) / 8.5), 1)[0] ?? "")}</text>`);
  }
  for (const link of content.links) {
    const from = layout.nodes.get(link.from), to = layout.nodes.get(link.to);
    if (!from || !to) continue;
    const { d, mid } = route(from, to);
    const color = link.color ?? MUTED;
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${link.style === "dashed" ? ' stroke-dasharray="8 6"' : ""} marker-end="url(#arrow-${color.slice(1)})"/>`);
    if (link.label) {
      const label = wrap(link.label, 28, 1)[0];
      const w = label.length * 7 + 14;
      parts.push(`<rect x="${mid.x - w / 2}" y="${mid.y - 11}" width="${w}" height="22" rx="6" fill="#fff" stroke="${LANE_LINE}"/><text x="${mid.x}" y="${mid.y + 4}" font-size="12" text-anchor="middle" fill="${INK}">${escape(label)}</text>`);
    }
  }
  for (const node of content.nodes) {
    const box = layout.nodes.get(node.id)!;
    const context = isContextNode(node);
    parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="${context ? "#fffaeb" : "#fff"}" stroke="${node.color ?? (context ? "#f79009" : "#98a2b3")}" stroke-width="${node.color ? 3 : 2}"${context ? ' stroke-dasharray="6 5"' : ""}/>`);
    const chars = Math.max(8, Math.floor((box.w - 28) / 7.2));
    const title = wrap(node.title, Math.floor(chars * 0.85), 2);
    title.forEach((line, i) => parts.push(`<text x="${box.x + 14}" y="${box.y + 28 + i * 18}" font-size="15" font-weight="700" fill="${INK}">${escape(line)}</text>`));
    const body = wrap(plain(node.comment), chars, Math.max(1, Math.min(4, Math.floor((box.h - 28 - title.length * 18 - 12) / 16))));
    body.forEach((line, i) => parts.push(`<text x="${box.x + 14}" y="${box.y + 28 + title.length * 18 + 10 + i * 16}" font-size="12" fill="${MUTED}">${escape(line)}</text>`));
  }
  const colors = [...new Set([MUTED, ...content.links.flatMap((link) => (link.color ? [link.color] : []))])];
  const defs = colors.map((color) => `<marker id="arrow-${color.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"><defs>${defs}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#ffffff"/>${parts.join("")}</svg>`;
  return { svg, width, height };
}

/** A PNG of the diagram, at most `maxWidth` pixels wide. Rejects where no canvas is available. */
export async function designPng(content: DesignContent, maxWidth = 1600): Promise<File> {
  const { svg, width, height } = designSvg(content);
  const scale = Math.min(1, maxWidth / width);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The diagram picture could not be drawn.")); });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas is available to draw the diagram.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The diagram picture could not be saved.");
    return new File([blob], `${content.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "design"}.png`, { type: "image/png" });
  } finally { URL.revokeObjectURL(url); }
}
