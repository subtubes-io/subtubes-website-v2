import type { DesignContent, DesignNode } from "./model/designs";
import { LEGEND_WIDTH, legendHeight } from "./model/design-legend";

export interface Box { x: number; y: number; w: number; h: number }

/** A curved connector between two boxes, leaving the sides when they are apart horizontally and the top or bottom when stacked; `mid` is where its label sits. */
export function route(a: Box, b: Box): { d: string; mid: { x: number; y: number } } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let p1: { x: number; y: number }, p2: { x: number; y: number }, c1: { x: number; y: number }, c2: { x: number; y: number };
  if (Math.abs(cb.x - ca.x) > 220 * 0.55) {
    const right = cb.x > ca.x;
    p1 = { x: right ? a.x + a.w : a.x, y: ca.y };
    p2 = { x: right ? b.x : b.x + b.w, y: cb.y };
    const m = Math.max(60, Math.abs(p2.x - p1.x) / 2) * (right ? 1 : -1);
    c1 = { x: p1.x + m, y: p1.y }; c2 = { x: p2.x - m, y: p2.y };
  } else {
    const down = cb.y > ca.y;
    p1 = { x: ca.x, y: down ? a.y + a.h : a.y };
    p2 = { x: cb.x, y: down ? b.y : b.y + b.h };
    const m = Math.max(40, Math.abs(p2.y - p1.y) / 2) * (down ? 1 : -1);
    c1 = { x: p1.x, y: p1.y + m }; c2 = { x: p2.x, y: p2.y - m };
  }
  const t = 0.5, u = 1 - t;
  const mid = {
    x: u ** 3 * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p2.x,
    y: u ** 3 * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p2.y,
  };
  return { d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, mid };
}

export const DESIGN_NODE_WIDTH = 240, DESIGN_NODE_HEIGHT = 144;
export type GroupCorner = "top-left" | "bottom-right";
export const nodeWidth = (node: DesignNode) => node.width ?? DESIGN_NODE_WIDTH;
export const nodeHeight = (node: DesignNode) => node.height ?? DESIGN_NODE_HEIGHT;

export function resizeDesignNode(content: DesignContent, id: string, corner: GroupCorner, dx: number, dy: number): DesignContent {
  const node = content.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown node ${id}.`);
  let x = node.x, y = node.y, width = nodeWidth(node), height = nodeHeight(node);
  if (corner === "bottom-right") {
    width = Math.max(160, Math.min(20000, Math.round(width + dx)));
    height = Math.max(100, Math.min(20000, Math.round(height + dy)));
  } else {
    x = Math.max(0, node.x + width - 20000, Math.min(20000, node.x + width - 160, Math.round(node.x + dx)));
    y = Math.max(0, node.y + height - 20000, Math.min(20000, node.y + height - 100, Math.round(node.y + dy)));
    width += node.x - x; height += node.y - y;
  }
  return { ...content, nodes: content.nodes.map((item) => item.id === id ? { ...item, x, y, width, height } : item) };
}

export function resizeDesignGroup(content: DesignContent, id: string, corner: GroupCorner, dx: number, dy: number): DesignContent {
  const group = content.groups.find((group) => group.id === id);
  if (!group) throw new Error(`Unknown group ${id}.`);
  if (content.kind === "swimlane") return resizeLane(content, id, corner, dx, dy);
  const box = designLayout(content).groups.get(id)!;
  const members = content.nodes.filter((node) => node.groupId === id);
  let x = group.x, y = group.y, width = box.w, height = box.h;
  if (corner === "bottom-right") {
    const minWidth = Math.max(300, ...members.map((node) => node.x + nodeWidth(node) + 40));
    const minHeight = Math.max(220, ...members.map((node) => node.y + nodeHeight(node) + 104));
    width = Math.min(20000, Math.max(minWidth, Math.round(box.w + dx)));
    height = Math.min(20000, Math.max(minHeight, Math.round(box.h + dy)));
  } else {
    // Moving the origin compensates member offsets so resizing does not move nodes.
    const maxX = Math.min(group.x + box.w - 300, ...members.map((node) => group.x + node.x));
    const maxY = Math.min(group.y + box.h - 220, ...members.map((node) => group.y + node.y));
    const minX = Math.max(0, group.x + box.w - 20000, ...members.map((node) => group.x + node.x - 20000));
    const minY = Math.max(0, group.y + box.h - 20000, ...members.map((node) => group.y + node.y - 20000));
    if (minX > maxX || minY > maxY) return content;
    x = Math.max(minX, Math.min(20000, maxX, Math.round(group.x + dx)));
    y = Math.max(minY, Math.min(20000, maxY, Math.round(group.y + dy)));
    width = box.w + group.x - x; height = box.h + group.y - y;
  }
  return {
    ...content,
    groups: content.groups.map((item) => item.id === id ? { ...item, x, y, width, height } : item),
    nodes: corner === "top-left" ? content.nodes.map((node) => node.groupId === id ? { ...node, x: node.x + group.x - x, y: node.y + group.y - y } : node) : content.nodes,
  };
}
/**
 * Swimlanes are stacked automatically, so their handles change size rather than position.
 * Thickness (row height / column width) is per lane; length along the flow is shared, so every lane gets it.
 * The top-left handle adds or removes space before the content by shifting steps; bottom-right does so after it.
 */
function resizeLane(content: DesignContent, id: string, corner: GroupCorner, dx: number, dy: number): DesignContent {
  const vertical = isVertical(content), padding = LANE_HEADER[vertical ? "vertical" : "horizontal"];
  const box = designLayout(content).groups.get(id)!;
  const across = Math.round(vertical ? dx : dy), along = Math.round(vertical ? dy : dx);
  const crossKey = vertical ? "x" : "y", lengthKey = vertical ? "y" : "x";
  const crossSize = vertical ? box.w : box.h, lengthSize = vertical ? box.h : box.w;
  const crossPad = (node: DesignNode) => vertical ? padding.x + nodeWidth(node) + 40 : padding.y + nodeHeight(node) + 24;
  const lengthPad = (node: DesignNode) => vertical ? padding.y + nodeHeight(node) + 60 : padding.x + nodeWidth(node) + 40;
  const crossMin = vertical ? 300 : 220, lengthMin = vertical ? 220 : 300;
  const members = content.nodes.filter((node) => node.groupId === id);
  let crossShift = 0, lengthShift = 0, cross = crossSize, length = lengthSize;
  if (corner === "bottom-right") {
    cross = Math.max(crossMin, ...members.map((node) => node[crossKey] + crossPad(node)), crossSize + across);
    length = Math.max(lengthMin, ...content.nodes.map((node) => node[lengthKey] + lengthPad(node)), lengthSize + along);
  } else {
    // Growing from the top-left pushes content away from the header; shrinking cannot pull steps past it.
    const crossLow = -Math.min(crossSize - crossMin, ...members.map((node) => node[crossKey]));
    const lengthLow = -Math.min(lengthSize - lengthMin, ...content.nodes.map((node) => node[lengthKey]));
    const crossHigh = Math.min(20000 - crossSize, ...members.map((node) => 20000 - node[crossKey]));
    const lengthHigh = Math.min(20000 - lengthSize, ...content.nodes.map((node) => 20000 - node[lengthKey]));
    if (crossLow > crossHigh || lengthLow > lengthHigh) return content;
    crossShift = Math.max(crossLow, Math.min(crossHigh, -across));
    lengthShift = Math.max(lengthLow, Math.min(lengthHigh, -along));
    cross = crossSize + crossShift; length = lengthSize + lengthShift;
  }
  cross = Math.min(20000, cross); length = Math.min(20000, length);
  if (cross === crossSize && length === lengthSize && !crossShift && !lengthShift) return content;
  return {
    ...content,
    groups: content.groups.map((group) => vertical
      ? { ...group, height: length, width: group.id === id ? cross : group.width }
      : { ...group, width: length, height: group.id === id ? cross : group.height }),
    nodes: content.nodes.map((node) => ({
      ...node,
      [lengthKey]: node[lengthKey] + lengthShift,
      [crossKey]: node[crossKey] + (node.groupId === id ? crossShift : 0),
    })),
  };
}
export const isVertical = (content: DesignContent) => content.kind === "swimlane" && content.orientation === "vertical";
/** Header band of a swimlane: left column for horizontal lanes, top row for vertical lanes. */
export const LANE_HEADER = { horizontal: { x: 180, y: 32 }, vertical: { x: 40, y: 136 } };
export const CONTEXT_NODE_WIDTH = 360, CONTEXT_NODE_HEIGHT = 200;
export const isContextNode = (node: { kind?: string }) => node.kind === "context";
export function designLayout(content: DesignContent) {
  const nodes = new Map<string, Box>(), groups = new Map<string, Box>();
  const origins = new Map<string, { x: number; y: number }>();
  const swimlane = content.kind === "swimlane", vertical = isVertical(content);
  const padding = !swimlane ? { x: 20, y: 80 } : LANE_HEADER[vertical ? "vertical" : "horizontal"];
  let laneX = 40, laneY = 40;
  // Lanes share their length along the flow: width for horizontal rows, height for vertical columns.
  const stepNodes = content.nodes.filter((node) => !isContextNode(node));
  const laneWidth = Math.max(300, ...content.groups.map((group) => group.width), ...stepNodes.map((node) => node.x + nodeWidth(node) + 220));
  const laneHeight = Math.max(220, ...content.groups.map((group) => group.height), ...stepNodes.map((node) => node.y + padding.y + nodeHeight(node) + 60));
  for (const group of content.groups) {
    const members = content.nodes.filter((node) => node.groupId === group.id);
    const fitWidth = Math.max(group.width, ...members.map((node) => padding.x + node.x + nodeWidth(node) + (vertical ? 40 : 20)));
    const fitHeight = Math.max(group.height, ...members.map((node) => padding.y + node.y + nodeHeight(node) + 24));
    const box = !swimlane ? { x: group.x, y: group.y, w: fitWidth, h: fitHeight }
      : vertical ? { x: laneX, y: 40, w: fitWidth, h: laneHeight } : { x: 40, y: laneY, w: laneWidth, h: fitHeight };
    groups.set(group.id, box);
    origins.set(group.id, { x: box.x + padding.x, y: box.y + padding.y });
    laneX += box.w + 16; laneY += box.h + 16;
  }
  for (const node of content.nodes) {
    const origin = node.groupId ? origins.get(node.groupId)! : { x: 0, y: 0 };
    nodes.set(node.id, { x: origin.x + node.x, y: origin.y + node.y, w: nodeWidth(node), h: nodeHeight(node) });
  }
  const boxes = [...nodes.values(), ...groups.values()];
  if (content.legend) boxes.push({ x: content.legend.x, y: content.legend.y, w: LEGEND_WIDTH, h: legendHeight(content) });
  return { nodes, groups, origins, width: Math.max(1000, ...boxes.map((box) => box.x + box.w + 80)), height: Math.max(700, ...boxes.map((box) => box.y + box.h + 80)) };
}

/** Turns horizontal lanes into vertical columns (or back), rotating each step's position so the flow direction follows. */
export function setLaneOrientation(content: DesignContent, orientation: "horizontal" | "vertical"): DesignContent {
  if (content.kind !== "swimlane" || (content.orientation ?? "horizontal") === orientation) return content;
  const vertical = orientation === "vertical";
  return {
    ...content, orientation,
    groups: content.groups.map((group) => ({ ...group, width: vertical ? 320 : 1100, height: vertical ? 700 : 260 })),
    nodes: content.nodes.map((node) => isContextNode(node) ? node : { ...node, x: node.y, y: node.x }),
  };
}

export function removeDesignNode(content: DesignContent, id: string): DesignContent {
  return { ...content, nodes: content.nodes.filter((node) => node.id !== id), links: content.links.filter((link) => link.from !== id && link.to !== id) };
}
export function removeDesignGroup(content: DesignContent, id: string): DesignContent {
  const members = new Set(content.nodes.filter((node) => node.groupId === id).map((node) => node.id));
  const layout = designLayout(content);
  return {
    ...content, groups: content.groups.filter((group) => group.id !== id),
    nodes: content.kind === "swimlane" ? content.nodes.filter((node) => !members.has(node.id)) :
      content.nodes.map((node) => members.has(node.id) ? { ...node, groupId: null, x: Math.min(20000, layout.nodes.get(node.id)!.x), y: Math.min(20000, layout.nodes.get(node.id)!.y) } : node),
    links: content.kind === "swimlane" ? content.links.filter((link) => !members.has(link.from) && !members.has(link.to)) : content.links,
  };
}

/** Shifts every top-level system item except one by (dx, dy), growing the canvas to the left/top without negative coordinates. */
export function shiftDesign(content: DesignContent, except: { kind: "node" | "group" | "legend"; id: string }, dx: number, dy: number): DesignContent {
  const move = <T extends { x: number; y: number }>(item: T) => ({ ...item, x: Math.min(20000, item.x + dx), y: Math.min(20000, item.y + dy) });
  return {
    ...content,
    groups: content.groups.map((group) => except.kind === "group" && except.id === group.id ? group : move(group)),
    nodes: content.nodes.map((node) => node.groupId || (except.kind === "node" && except.id === node.id) ? node : move(node)),
    ...(content.legend ? { legend: except.kind === "legend" ? content.legend : move(content.legend) } : {}),
  };
}

const clampCoordinate = (value: number) => Math.max(0, Math.min(20000, Math.round(value)));
const inside = (box: Box, x: number, y: number) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;

/** Makes a grouped node canvas-positioned for a drag while freezing its group's visible size. */
export function detachDesignNode(content: DesignContent, id: string): DesignContent {
  const node = content.nodes.find((item) => item.id === id);
  if (!node?.groupId) return content;
  const layout = designLayout(content), box = layout.nodes.get(id)!, group = layout.groups.get(node.groupId)!;
  return {
    ...content,
    groups: content.groups.map((item) => item.id === node.groupId ? { ...item, width: content.kind === "system" || isVertical(content) ? Math.min(20000, group.w) : item.width, height: content.kind === "system" || !isVertical(content) ? Math.min(20000, group.h) : item.height } : item),
    nodes: content.nodes.map((item) => item.id === id ? { ...item, groupId: null, x: clampCoordinate(box.x), y: clampCoordinate(box.y) } : item),
  };
}

/** Assigns a dropped node to the topmost group under its center, preserving its canvas position. */
export function placeDesignNode(content: DesignContent, id: string, fallback: string | null): DesignContent {
  const node = content.nodes.find((item) => item.id === id);
  if (!node || isContextNode(node)) return content;
  const layout = designLayout(content), box = layout.nodes.get(id)!;
  const target = [...content.groups].reverse().find((group) => inside(layout.groups.get(group.id)!, box.x + box.w / 2, box.y + box.h / 2))?.id ?? fallback;
  const origin = target ? layout.origins.get(target) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  return { ...content, nodes: content.nodes.map((item) => item.id === id ? { ...item, groupId: target, x: clampCoordinate(box.x - origin.x), y: clampCoordinate(box.y - origin.y) } : item) };
}

/** Lets a system group adopt ungrouped nodes drawn entirely inside it before it moves. */
export function adoptDesignNodes(content: DesignContent, id: string): DesignContent {
  if (content.kind !== "system") return content;
  const layout = designLayout(content), group = layout.groups.get(id), origin = layout.origins.get(id);
  if (!group || !origin) return content;
  const contained = (box: Box) => inside(group, box.x, box.y) && inside(group, box.x + box.w, box.y + box.h);
  const later = content.groups.slice(content.groups.findIndex((item) => item.id === id) + 1).map((item) => layout.groups.get(item.id)!);
  const adopt = content.nodes.filter((node) => {
    const box = layout.nodes.get(node.id)!;
    return !node.groupId && !isContextNode(node) && contained(box) && !later.some((other) => inside(other, box.x + box.w / 2, box.y + box.h / 2));
  });
  if (!adopt.length) return content;
  const ids = new Set(adopt.map((node) => node.id));
  return { ...content, nodes: content.nodes.map((node) => ids.has(node.id) ? { ...node, groupId: id, x: clampCoordinate(node.x - origin.x), y: clampCoordinate(node.y - origin.y) } : node) };
}
