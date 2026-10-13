"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId, type RefObject, type ReactNode } from "react";
import type { DesignContent, DesignNodeStatus } from "./model/designs";
import { route, adoptDesignNodes, CONTEXT_NODE_HEIGHT, CONTEXT_NODE_WIDTH, isContextNode, DESIGN_NODE_HEIGHT, DESIGN_NODE_WIDTH, designLayout, detachDesignNode, isVertical, placeDesignNode, resizeDesignGroup, resizeDesignNode, shiftDesign, type GroupCorner } from "./design-layout";
import { DesignInlineField } from "./DesignInlineField";
import { DesignColorPicker } from "./DesignColorPicker";
import { DesignNodeDrawer } from "./DesignNodeDrawer";
import { NodeStatusIcon, STATUS_LABEL } from "./DesignNodeStatus";
import { legendEntries, legendKey, LEGEND_WIDTH, type LegendEntry } from "./model/design-legend";

export type DesignSelection = { kind: "node" | "group" | "link" | "legend"; id: string } | undefined;
interface CanvasConfig {
  readOnly?: boolean;
  onOpen?: (selection: NonNullable<DesignSelection>) => void;
  renderComment?: (text: string) => ReactNode;
  /** Extra read-only content (for example file references) shown at the top of a node's drawer. */
  renderNodeExtras?: (nodeId: string, close: () => void) => ReactNode;
  /** Small marker shown in a node's header, such as the number of recorded decisions. */
  renderNodeBadge?: (nodeId: string) => ReactNode;
  /** Shown as a copyable ID in the node drawer. */
  designId?: string; designIdLabel?: string;
  layout?: { disabled: boolean; onMove: (kind: "node" | "legend", id: string, x: number, y: number) => void; onResize: (content: DesignContent) => void; onEnd: () => void };
  content: DesignContent; selection: DesignSelection; editSession: number; disabled: boolean; connecting: boolean;
  onSelect: (selection: DesignSelection) => void; onNode: (id: string) => void;
  onMove: (kind: "node" | "group" | "legend", id: string, x: number, y: number) => void;
  onDragStart: () => void;
  onInteractionEnd: () => void;
  onResize: (content: DesignContent) => void;
  onTransform: (update: (content: DesignContent) => DesignContent) => void;
  onAddNode: (groupId: string | null, at?: { x: number; y: number }) => void;
  onAddGroup: (at?: { x: number; y: number }) => void;
  onAddContext: (at?: { x: number; y: number }) => void;
  onConnect: (from: string, to: string) => void;
  onStartConnect: (from: string) => void;
  onCancelConnect: () => void;
  onEdit: (kind: "node" | "group", id: string, field: "title" | "comment", value: string) => void;
  onEditLink: (id: string, label: string) => void;
  onLinkStyle: (id: string, style: "solid" | "dashed") => void;
  onLinkColor: (id: string, color?: string) => void;
  onNodeColor: (id: string, color?: string) => void;
  onNodeStatus: (id: string, status?: DesignNodeStatus) => void;
  onAddLegend: (at: { x: number; y: number }) => void;
  onLegendMeaning: (entry: LegendEntry, text: string) => void;
  focusNode?: { id: string; requestId: number };
  onOrientation: (orientation: "horizontal" | "vertical") => void;
  onMoveLane: (id: string, delta: -1 | 1) => void;
  onDelete: () => void;
  onSave: () => void;
  /** Floating UI over the canvas's top edge; fitting keeps content below it. */
  overlay?: RefObject<HTMLElement | null>;
}
type ReadOnlyConfig = Pick<CanvasConfig, "content" | "selection" | "onSelect" | "onNode" | "layout" | "onOpen" | "renderComment" | "renderNodeExtras" | "renderNodeBadge" | "designId" | "designIdLabel" | "overlay"> & { readOnly: true };
const rejectEdit = () => { throw new Error("Saved report swimlane diagrams are read-only."); };
function canvasConfig(config: CanvasConfig | ReadOnlyConfig): CanvasConfig {
  if (!config.readOnly) return config;
  return {
    ...config, disabled: true, editSession: 0, connecting: false,
    onMove: rejectEdit, onDragStart: rejectEdit, onInteractionEnd: rejectEdit, onResize: rejectEdit,
    onTransform: rejectEdit, onAddNode: rejectEdit, onAddGroup: rejectEdit, onAddContext: rejectEdit, onConnect: rejectEdit,
    onStartConnect: rejectEdit, onCancelConnect: rejectEdit, onEdit: rejectEdit, onEditLink: rejectEdit,
    onLinkStyle: rejectEdit, onLinkColor: rejectEdit, onNodeColor: rejectEdit, onNodeStatus: rejectEdit, onAddLegend: rejectEdit,
    onLegendMeaning: rejectEdit, onOrientation: rejectEdit, onMoveLane: rejectEdit, onDelete: rejectEdit, onSave: rejectEdit,
  };
}
export function DesignCanvas({ config: input }: { config: CanvasConfig | ReadOnlyConfig }) {
  const config = canvasConfig(input);
  const { content, selection, disabled, connecting, onSelect, onNode, onMove } = config;
  // A saved report's diagram can be rearranged and resized when its layout can be saved.
  const canResize = !!config.readOnly && !!config.layout && !config.layout.disabled;
  const applyResize = (next: DesignContent) => {
    if (config.readOnly) { config.layout?.onResize(next); config.layout?.onEnd(); }
    else { config.onDragStart(); config.onResize(next); config.onInteractionEnd(); }
  };
  const geometry = useMemo(() => designLayout(content), [content]);
  const entries = useMemo(() => legendEntries(content), [content]);
  // A saved diagram that uses colors or dashed lines always shows a legend, placed beside the diagram when its author did not write one. Only an authored legend can be moved.
  const legend = content.legend ?? (config.readOnly && entries.length ? { x: geometry.width + 40, y: 200, meanings: [] } : undefined);
  const title = (id: string) => content.nodes.find((node) => node.id === id)?.title ?? id;
  const linkName = (link: DesignContent["links"][number]) => link.label || `${title(link.from)} to ${title(link.to)}`;
  const viewport = useRef<HTMLDivElement>(null);
  const marker = useId().replaceAll(":", "");
  const [view, setView] = useState({ x: 20, y: 20, scale: 0.8 });
  // Growing past the left/top edge shifts stored coordinates; each content version remembers that shift so the view (and undo) stays visually stable.
  const origins = useRef(new WeakMap<DesignContent, { x: number; y: number }>()), lastOrigin = useRef({ x: 0, y: 0 }), pendingGrow = useRef({ x: 0, y: 0 });
  let origin = origins.current.get(content);
  if (!origin) {
    origin = { x: lastOrigin.current.x + pendingGrow.current.x, y: lastOrigin.current.y + pendingGrow.current.y };
    pendingGrow.current = { x: 0, y: 0 }; origins.current.set(content, origin);
  }
  lastOrigin.current = origin;
  const offset = { x: view.x - origin.x * view.scale, y: view.y - origin.y * view.scale };
  const drag = useRef<{ pointer: number; startX: number; startY: number; x: number; y: number; kind?: "node" | "group" | "legend"; id?: string; moved: boolean; corner?: GroupCorner; origin?: string | null; initial: DesignContent; scale: number }>(undefined);
  const suppressClick = useRef(false);
  const linkDrag = useRef<{ pointer: number; from: string; startX: number; startY: number; moved: boolean }>(undefined);
  const [pending, setPending] = useState<{ from: string; x: number; y: number }>();
  const [menu, setMenu] = useState<{ left: number; top: number; world: { x: number; y: number }; groupId: string | null; link?: string }>();
  const vertical = isVertical(content);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { menuRef.current?.querySelector("button")?.focus(); }, [menu]);
  const world = (clientX: number, clientY: number) => {
    const box = viewport.current!.getBoundingClientRect();
    return { x: (clientX - box.left - offset.x) / view.scale, y: (clientY - box.top - offset.y) / view.scale };
  };
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(20000, value)));
  // Centers the new node on the point, relative to its group's content origin.
  const addNodeAt = (groupId: string | null, point: { x: number; y: number }) => {
    const origin = groupId ? geometry.origins.get(groupId)! : { x: 0, y: 0 };
    config.onAddNode(groupId, { x: clamp(point.x - origin.x - DESIGN_NODE_WIDTH / 2), y: clamp(point.y - origin.y - DESIGN_NODE_HEIGHT / 2) });
  };
  const groupAt = (target: EventTarget) => (target as Element).closest<HTMLElement>("[data-design-kind='group']")?.dataset.id ?? null;
  const blank = (target: EventTarget) => !(target as Element).closest("input,textarea,button,summary,.design-color,.design-legend,.design-zoom,.design-edge,.design-link-label,.design-link-style,.design-node,.design-group-heading,.design-lane-tools,.design-context-menu");
  const menuLink = menu?.link ? content.links.find((link) => link.id === menu.link) : undefined;
  const menuItems = menuLink ? [
    { label: menuLink.style === "dashed" ? "Solid line" : "Dashed line", run: () => config.onLinkStyle(menuLink.id, menuLink.style === "dashed" ? "solid" : "dashed") },
    { label: menuLink.label ? "Edit label" : "Add label", run: () => editLink(menuLink.id) },
  ] : menu ? content.kind === "system"
    ? [{ label: menu.groupId ? "Add node to this group" : "Add node here", run: () => addNodeAt(menu.groupId, menu.world) }, { label: "Add group here", run: () => config.onAddGroup({ x: clamp(menu.world.x), y: clamp(menu.world.y) }) }]
    : [...(menu.groupId ? [{ label: "Add step to this lane", run: () => addNodeAt(menu.groupId, menu.world) }] : []), { label: "Add lane", run: () => config.onAddGroup() },
      { label: vertical ? "Switch to horizontal lanes" : "Switch to vertical lanes", run: () => config.onOrientation(vertical ? "horizontal" : "vertical") }] : [];
  if (menu && !menuLink) menuItems.push({ label: "Add context node here", run: () => config.onAddContext({ x: clamp(menu.world.x - CONTEXT_NODE_WIDTH / 2), y: clamp(menu.world.y - CONTEXT_NODE_HEIGHT / 2) }) });
  if (menu && !menuLink && !content.legend) menuItems.push({ label: "Add legend here", run: () => config.onAddLegend({ x: clamp(menu.world.x), y: clamp(menu.world.y) }) });
  const closeMenu = (focus = false) => { setMenu(undefined); if (focus) viewport.current?.focus(); };
  const [editingLink, setEditingLink] = useState<string>();
  const [drawerNode, setDrawerNode] = useState<string>();
  const openNode = drawerNode ? content.nodes.find((node) => node.id === drawerNode) : undefined;
  const editLink = (id: string) => { onSelect({ kind: "link", id }); if (!disabled && !connecting) setEditingLink(id); };
  const finishDrag = () => {
    const current = drag.current;
    drag.current = undefined;
    if (config.readOnly) {
      if (current?.moved && current.kind) config.layout?.onEnd();
      return;
    }
    if (current?.moved && current.kind === "node" && current.id && !current.corner) {
      const fallback = content.kind === "swimlane" ? current.origin ?? null : null;
      config.onTransform((latest) => placeDesignNode(latest, current.id!, fallback));
    }
    if (current?.moved && current.kind) config.onInteractionEnd();
  };
  const fit = () => {
    if (!viewport.current) return;
    const box = viewport.current.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const covered = config.overlay?.current?.getBoundingClientRect();
    const top = covered && covered.height ? Math.max(0, covered.bottom - box.top) : 0;
    const height = box.height - top;
    if (height <= 0) return;
    const scale = Math.max(0.1, Math.min(1, (box.width - 40) / geometry.width, (height - 40) / geometry.height));
    setView({ x: (box.width - geometry.width * scale) / 2 + origin.x * scale, y: top + (height - geometry.height * scale) / 2 + origin.y * scale, scale });
  };
  useLayoutEffect(fit, []);
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let initialFitDone = false;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0 && !initialFitDone) {
          initialFitDone = true;
          fit();
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [geometry.width, geometry.height]);
  useEffect(() => {
    if (!config.focusNode) return;
    const node = geometry.nodes.get(config.focusNode.id);
    if (!node) return;
    const box = viewport.current!.getBoundingClientRect();
    setView((view) => ({ ...view, x: box.width / 2 - (node.x + node.w / 2 - origin.x) * view.scale, y: box.height / 2 - (node.y + node.h / 2 - origin.y) * view.scale }));
  }, [config.focusNode?.requestId]);
  const zoom = (factor: number) => {
    const box = viewport.current!.getBoundingClientRect();
    setView((old) => {
      const scale = Math.max(0.1, Math.min(2, old.scale * factor));
      return { x: box.width / 2 - (box.width / 2 - old.x) * scale / old.scale, y: box.height / 2 - (box.height / 2 - old.y) * scale / old.scale, scale };
    });
  };
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest(".design-zoom,input,textarea")) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.01));
      else setView((old) => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return <>
  <div className={`design-canvas${connecting || pending ? " connecting" : ""}${canResize ? " resizable" : ""}`} ref={viewport} aria-label="Design canvas" tabIndex={0}
    aria-description={config.readOnly ? "Saved diagram. Click to select; double-click or press Enter to open details. Drag step headings to rearrange when layout saving is available. Drag empty space or scroll to pan; pinch or use zoom controls to zoom." : content.kind === "system" ? "Double-click to add a node. Right-click or press Shift+F10 to add a node or group." : "Double-click empty space to add a lane, or inside a lane to add a step. Right-click or press Shift+F10 for options, including lane direction."}
    onPointerDown={(event) => {
      if (menu && !(event.target as Element).closest(".design-context-menu")) setMenu(undefined);
      if (event.button !== 0 || (event.target as Element).closest(".design-zoom,.design-color,.design-edge,.design-link-label,.design-link-style,.design-lane-tools,.design-context-menu,input,textarea")) return;
      if (config.readOnly && (event.target as Element).closest("button:not([data-resize]),a")) return;
      suppressClick.current = false;
      const connector = (event.target as Element).closest<HTMLElement>(".design-connector")?.dataset.from;
      if (connector) {
        if (!disabled) linkDrag.current = { pointer: event.pointerId, from: connector, startX: event.clientX, startY: event.clientY, moved: false };
        return;
      }
      const element = (event.target as HTMLElement).closest<HTMLElement>("[data-design-kind]");
      const kind = element?.dataset.designKind, id = element?.dataset.id;
      if (kind === "node" && id) { onNode(id); if (connecting) return; }
      else if (kind === "group" && id) onSelect({ kind, id });
      else if (kind === "legend") onSelect({ kind, id: "legend" });
      else onSelect(undefined);
      if (disabled) {
        if (config.readOnly) {
          const handle = (event.target as Element).closest<HTMLElement>("[data-resize]")?.dataset.resize;
          const handleCorner = handle === "top-left" || handle === "bottom-right" ? handle : undefined;
          if (canResize && handleCorner && (kind === "node" || kind === "group") && id) {
            drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: 0, y: 0, kind, id, moved: false, corner: handleCorner, initial: content, scale: view.scale };
            return;
          }
          const movable = config.layout && !config.layout.disabled && !(event.target as Element).closest(".design-inline-body");
          const node = movable && kind === "node" ? content.nodes.find(node => node.id === id) : undefined;
          const legend = movable && kind === "legend" ? content.legend : undefined;
          if (node || legend || blank(event.target)) drag.current = {
            pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: node?.x ?? legend?.x ?? view.x, y: node?.y ?? legend?.y ?? view.y,
            kind: node ? "node" : legend ? "legend" : undefined, id,
            moved: false, initial: content, scale: view.scale,
          };
        }
        return;
      }
      if (connecting && (kind === "group" || kind === "legend")) return;
      const node = kind === "node" ? content.nodes.find((node) => node.id === id) : undefined;
      const resize = (event.target as Element).closest<HTMLElement>("[data-resize]")?.dataset.resize;
      const corner = resize === "top-left" || resize === "bottom-right" ? resize : undefined;
      // Lanes are not dragged, but their corner handles resize them.
      const group = kind === "group" && (content.kind === "system" || corner) ? content.groups.find((group) => group.id === id) : undefined;
      const legend = kind === "legend" ? content.legend : undefined;
      drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: node?.x ?? group?.x ?? legend?.x ?? view.x, y: node?.y ?? group?.y ?? legend?.y ?? view.y, kind: node ? "node" : group ? "group" : legend ? "legend" : undefined, id, moved: false, corner, origin: node?.groupId ?? null, initial: content, scale: view.scale };
    }}
    onPointerMove={(event) => {
      const link = linkDrag.current;
      if (link?.pointer === event.pointerId) {
        if (!link.moved && Math.abs(event.clientX - link.startX) + Math.abs(event.clientY - link.startY) > 3) { link.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
        if (link.moved) setPending({ from: link.from, ...world(event.clientX, event.clientY) });
        return;
      }
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
      if (!current.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        current.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        if (current.kind && !config.readOnly) config.onDragStart();
        if (!config.readOnly && current.kind === "node" && current.id && current.origin && !current.corner) {
          const detached = detachDesignNode(content, current.id), node = detached.nodes.find((item) => item.id === current.id)!;
          config.onResize(detached); current.x = node.x; current.y = node.y;
        } else if (current.kind === "group" && current.id && !current.corner) config.onTransform((latest) => adoptDesignNodes(latest, current.id!));
      }
      if (!current.moved) return;
      suppressClick.current = true;
      if (config.readOnly && current.corner && current.id && (current.kind === "node" || current.kind === "group")) {
        config.layout?.onResize((current.kind === "node" ? resizeDesignNode : resizeDesignGroup)(current.initial, current.id, current.corner, dx / current.scale, dy / current.scale));
      } else if (config.readOnly && current.id && (current.kind === "node" || current.kind === "legend")) {
        config.layout?.onMove(current.kind, current.id, clamp(current.x + dx / current.scale), clamp(current.y + dy / current.scale));
      } else if (current.corner && current.id) config.onResize((current.kind === "node" ? resizeDesignNode : resizeDesignGroup)(current.initial, current.id, current.corner, dx / current.scale, dy / current.scale));
      else if (current.kind && current.id) {
        let x = Math.round(Math.min(20000, current.x + dx / current.scale)), y = Math.round(Math.min(20000, current.y + dy / current.scale));
        // System canvases grow past the left/top edge: everything else shifts instead, and the view pans to keep it in place.
        const growX = content.kind === "system" ? Math.max(0, -x) : 0, growY = content.kind === "system" ? Math.max(0, -y) : 0;
        if (growX || growY) {
          const target = { kind: current.kind, id: current.id };
          config.onTransform((latest) => shiftDesign(latest, target, growX, growY));
          current.x += growX; current.y += growY;
          pendingGrow.current = { x: pendingGrow.current.x + growX, y: pendingGrow.current.y + growY };
          x += growX; y += growY;
        }
        onMove(current.kind, current.id, Math.max(0, x), Math.max(0, y));
      } else setView((old) => ({ ...old, x: current.x + dx, y: current.y + dy }));
    }}
    onPointerUp={(event) => {
      const link = linkDrag.current;
      if (link?.pointer === event.pointerId) {
        linkDrag.current = undefined; setPending(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-design-kind='node']")?.dataset.id;
        if (!link.moved) config.onStartConnect(link.from);
        else if (target && target !== link.from) config.onConnect(link.from, target);
        return;
      }
      if (drag.current?.pointer !== event.pointerId) return;
      finishDrag();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { linkDrag.current = undefined; setPending(undefined); finishDrag(); }} onLostPointerCapture={() => { if (!linkDrag.current) finishDrag(); }}
    onDoubleClick={(event) => {
      if (config.readOnly) {
        if ((event.target as Element).closest("button,a,input,textarea")) return;
        const link = (event.target as Element).closest<HTMLElement>("[data-link]")?.dataset.link;
        if (link) { config.onOpen?.({ kind: "link", id: link }); return; }
        const element = (event.target as Element).closest<HTMLElement>("[data-design-kind]");
        const kind = element?.dataset.designKind, id = element?.dataset.id;
        if (id && kind === "node") setDrawerNode(id);
        else if (id && (kind === "group" || kind === "legend")) config.onOpen?.({ kind, id });
        return;
      }
      if (disabled || connecting || !blank(event.target)) return;
      const groupId = groupAt(event.target), point = world(event.clientX, event.clientY);
      if (groupId || content.kind === "system") addNodeAt(groupId, point);
      else config.onAddGroup();
    }}
    onContextMenu={(event) => {
      const link = (event.target as Element).closest<HTMLElement | SVGElement>("[data-link]")?.dataset.link;
      if (!link && !blank(event.target)) return;
      event.preventDefault();
      if (disabled || connecting) return;
      if (link) onSelect({ kind: "link", id: link });
      const box = viewport.current!.getBoundingClientRect();
      setMenu({ left: event.clientX - box.left, top: event.clientY - box.top, world: world(event.clientX, event.clientY), groupId: groupAt(event.target), link });
    }}
    onKeyDown={(event) => {
      const typing = (event.target as Element).closest("input,textarea,.design-color");
      if (event.key === "Escape" && connecting) { event.preventDefault(); config.onCancelConnect(); return; }
      if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && event.target === event.currentTarget && !disabled && !connecting) {
        event.preventDefault();
        const box = viewport.current!.getBoundingClientRect();
        setMenu({ left: box.width / 2, top: box.height / 2, world: world(box.left + box.width / 2, box.top + box.height / 2), groupId: null });
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selection && !disabled && !typing) { event.preventDefault(); config.onDelete(); }
    }}
    onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; } }}>
    <div className="design-world" style={{ width: geometry.width, height: geometry.height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${view.scale})` }}>
      {content.groups.map((group, index) => {
        const box = geometry.groups.get(group.id)!, selected = selection?.kind === "group" && selection.id === group.id;
        return <section key={group.id} data-design-kind="group" data-id={group.id} className={`design-group ${content.kind}${vertical ? " vertical" : ""}${selected ? " selected" : ""}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          <div className="design-group-heading" role="button" tabIndex={0} aria-label={`Select ${content.kind === "system" ? "group" : "lane"} ${group.title}`} onClick={() => onSelect({ kind: "group", id: group.id })} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect({ kind: "group", id: group.id }); if (config.readOnly && event.key === "Enter") config.onOpen?.({ kind: "group", id: group.id }); } }}>
            <DesignInlineField key={config.editSession} config={{ title: true, value: group.title, label: "Canvas group title", disabled: disabled || connecting, readOnly: config.readOnly, onStart: config.onDragStart, onEnd: config.onInteractionEnd, onSave: config.onSave, onCommit: (value) => config.onEdit("group", group.id, "title", value) }} />
            {config.readOnly && group.comment && <div className="design-inline-body">{config.renderComment ? config.renderComment(group.comment) : group.comment}</div>}
          </div>
          {content.kind === "swimlane" ? <div className="design-lane-tools">
            <button type="button" className="design-lane-add" aria-label={`Add node to lane ${group.title}`} title={`Add node to ${group.title}`} disabled={disabled || connecting} onClick={() => config.onAddNode(group.id)}>+</button>
            <button type="button" aria-label={`Move lane ${group.title} ${vertical ? "left" : "up"}`} title={`Move lane ${vertical ? "left" : "up"}`} disabled={disabled || connecting || index === 0} onClick={() => config.onMoveLane(group.id, -1)}>{vertical ? "←" : "↑"}</button>
            <button type="button" aria-label={`Move lane ${group.title} ${vertical ? "right" : "down"}`} title={`Move lane ${vertical ? "right" : "down"}`} disabled={disabled || connecting || index === content.groups.length - 1} onClick={() => config.onMoveLane(group.id, 1)}>{vertical ? "→" : "↓"}</button>
          </div> : null}
          {(["top-left", "bottom-right"] as const).map((corner) => <button type="button" key={corner} className={`design-resize ${corner}`} data-resize={corner} aria-label={`Resize ${content.kind === "system" ? "group" : "lane"} ${group.title} from ${corner}`} title="Drag to resize; arrow keys resize by 10" disabled={(disabled && !canResize) || connecting} onKeyDown={(event) => {
              const delta = event.shiftKey ? 50 : 10;
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || (disabled && !canResize) || connecting) return;
              event.preventDefault(); event.stopPropagation();
              applyResize(resizeDesignGroup(content, group.id, corner, event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0, event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0));
            }} />)}
        </section>;
      })}
      <svg className="design-edges" width={geometry.width} height={geometry.height} aria-label="Design links">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" /></marker></defs>
        {content.links.map((link) => {
          const from = geometry.nodes.get(link.from)!, to = geometry.nodes.get(link.to)!;
          const curve = route(from, to);
          return <g className={`design-edge${link.style === "dashed" ? " dashed" : ""}${selection?.kind === "link" && selection.id === link.id ? " selected" : ""}`} key={link.id}>
            <defs><marker id={`${marker}-${link.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" style={{ fill: link.color ?? "var(--accent)" }} /></marker></defs>
            <path d={curve.d} style={{ stroke: link.color ?? "var(--accent)" }} markerEnd={`url(#${marker}-${link.id})`} />
            <path className="design-edge-hit" data-link={link.id} d={curve.d} tabIndex={0} role="button" aria-label={`Select link ${linkName(link)}`} aria-description={config.readOnly ? "Double-click or press Enter to read connection details" : "Double-click or press Enter to edit its label"} onClick={() => onSelect({ kind: "link", id: link.id })} onDoubleClick={() => config.readOnly ? config.onOpen?.({ kind: "link", id: link.id }) : editLink(link.id)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (event.key === "Enter") { if (config.readOnly) config.onOpen?.({ kind: "link", id: link.id }); else editLink(link.id); } else onSelect({ kind: "link", id: link.id }); }
              if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && !disabled && !connecting) {
                event.preventDefault(); event.stopPropagation(); onSelect({ kind: "link", id: link.id });
                setMenu({ left: curve.mid.x * view.scale + offset.x, top: curve.mid.y * view.scale + offset.y, world: curve.mid, groupId: null, link: link.id });
              }
            }} />
          </g>;
        })}
        {pending && (() => {
          const from = geometry.nodes.get(pending.from)!, x = from.x + from.w, y = from.y + from.h / 2;
          return <g className="design-edge pending"><path d={`M${x},${y} L${pending.x},${pending.y}`} markerEnd={`url(#${marker})`} /></g>;
        })()}
      </svg>
      {content.links.map((link) => {
        if (!link.label && editingLink !== link.id) return null;
        const from = geometry.nodes.get(link.from)!, to = geometry.nodes.get(link.to)!, curve = route(from, to);
        const editing = editingLink === link.id;
        return <div key={link.id} data-link={link.id} className={`design-link-label${selection?.kind === "link" && selection.id === link.id ? " selected" : ""}${editing ? " editing" : ""}`} style={{ left: curve.mid.x, top: curve.mid.y }} onClick={() => onSelect({ kind: "link", id: link.id })}>
          <DesignInlineField key={`${link.id}-${config.editSession}-${editing}`} config={{ title: true, optional: true, maxLength: 500, autoStart: editing, value: link.label, label: "Canvas link label", className: "design-link-text", disabled: disabled || connecting, readOnly: config.readOnly, onStart: config.onDragStart, onSave: config.onSave, onCommit: (value) => config.onEditLink(link.id, value), onEnd: () => { setEditingLink(undefined); config.onInteractionEnd(); } }} />
        </div>;
      })}
      {(() => {
        const link = selection?.kind === "link" && !disabled && !connecting && editingLink !== selection.id ? content.links.find((item) => item.id === selection.id) : undefined;
        if (!link) return null;
        const mid = route(geometry.nodes.get(link.from)!, geometry.nodes.get(link.to)!).mid;
        return <div className="design-link-style" role="group" aria-label="Line style" style={{ left: mid.x, top: mid.y + (link.label ? 34 : 18) }}>
          {(["solid", "dashed"] as const).map((style) => <button type="button" key={style} className={style} aria-pressed={(link.style ?? "solid") === style} aria-label={`${style === "solid" ? "Solid" : "Dashed"} line`} onClick={() => config.onLinkStyle(link.id, style)}><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" /></svg>{style === "solid" ? "Solid" : "Dashed"}</button>)}
          <DesignColorPicker key={link.id} config={{ label: "Line color", color: link.color, fallback: "var(--accent)", onChange: (color) => config.onLinkColor(link.id, color) }} />
        </div>;
      })()}
      {content.nodes.map((node) => {
        const box = geometry.nodes.get(node.id)!;
        const contextNode = isContextNode(node);
        return <div role="button" tabIndex={0} key={node.id} data-design-kind="node" data-id={node.id} aria-label={`Select ${contextNode ? "context node" : "node"} ${node.title}`}
          className={`design-node${contextNode ? " context" : ""}${selection?.kind === "node" && selection.id === node.id ? " selected" : ""}`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderColor: node.color }} onClick={(event) => { if (!connecting && event.detail === 0 && event.target === event.currentTarget) onSelect({ kind: "node", id: node.id }); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onNode(node.id); if (event.key === "Enter" && !connecting) setDrawerNode(node.id); } }}>
          <strong className="design-inline-title" title={`${node.status ? `${STATUS_LABEL[node.status]} · ` : ""}Double-click to open details`} onDoubleClick={(event) => { event.stopPropagation(); if (!connecting) setDrawerNode(node.id); }}>{node.title}<small className="design-node-marks">{config.renderNodeBadge?.(node.id)}{!contextNode && <NodeStatusIcon status={node.status} />}</small></strong>
          {config.readOnly && config.renderComment ? <div className="design-inline-body">{config.renderComment(node.comment)}</div>
            : <DesignInlineField key={`comment-${config.editSession}`} config={{ value: node.comment, label: "Canvas node comment", render: config.renderComment, disabled: disabled || connecting, readOnly: config.readOnly, onStart: config.onDragStart, onEnd: config.onInteractionEnd, onSave: config.onSave, onCommit: (value) => config.onEdit("node", node.id, "comment", value) }} />}
          {(["top-left", "bottom-right"] as const).map((corner) => <button type="button" key={corner} className={`design-resize ${corner}`} data-resize={corner} aria-label={`Resize node ${node.title} from ${corner}`} title="Drag to resize; arrow keys resize by 10" disabled={(disabled && !canResize) || connecting} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || (disabled && !canResize) || connecting) return;
            event.preventDefault(); event.stopPropagation();
            const delta = event.shiftKey ? 50 : 10;
            applyResize(resizeDesignNode(content, node.id, corner, event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0, event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0));
          }} />)}
          {!contextNode && content.nodes.filter((item) => !isContextNode(item)).length > 1 && <button type="button" className="design-connector" data-from={node.id} aria-label={`Connect from ${node.title}`} title="Drag to another node to connect" disabled={disabled || connecting} onClick={(event) => { if (event.detail === 0) config.onStartConnect(node.id); }} />}
        </div>;
      })}
      {(() => {
        const node = selection?.kind === "node" && !disabled && !connecting ? content.nodes.find((item) => item.id === selection.id) : undefined;
        if (!node) return null;
        const box = geometry.nodes.get(node.id)!;
        return <div className="design-node-color" style={{ left: box.x + box.w / 2, top: box.y - 30 }}><DesignColorPicker key={node.id} config={{ label: "Node border color", color: node.color, fallback: "var(--line-strong)", onChange: (color) => config.onNodeColor(node.id, color) }} /></div>;
      })()}
      {legend && <div className={`design-legend${selection?.kind === "legend" ? " selected" : ""}`} data-design-kind="legend" data-id="legend" role="group" aria-label="Design legend" tabIndex={0}
        onFocus={(event) => { if (event.target === event.currentTarget) onSelect({ kind: "legend", id: "legend" }); }}
        style={{ left: legend.x, top: legend.y, width: LEGEND_WIDTH }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || disabled || connecting || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          const legend = content.legend;
          if (!legend) return;
          event.preventDefault(); config.onDragStart();
          const delta = event.shiftKey ? 50 : 10;
          onMove("legend", "legend", clamp(legend.x + (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0)), clamp(legend.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0)));
          config.onInteractionEnd();
        }}>
        <strong className="design-legend-title">Legend</strong>
        {(["line", "node"] as const).map((kind) => <section key={kind} aria-label={kind === "line" ? "Line variations" : "Node colors"}>
          <h3>{kind === "line" ? "Lines" : "Nodes"}</h3>
          {entries.filter((entry) => entry.kind === kind).map((entry) => <div className="design-legend-entry" key={legendKey(entry)}>
            {kind === "line" ? <svg width="42" height="14" aria-hidden="true"><line x1="0" y1="7" x2="42" y2="7" stroke={entry.color ?? "var(--accent)"} strokeWidth="3" strokeDasharray={entry.style === "dashed" ? "6 4" : undefined} /></svg> : <i style={{ borderColor: entry.color }} />}
            <div><small>{kind === "line" ? `${entry.style === "dashed" ? "Dashed" : "Solid"} · ` : ""}{entry.color ?? "Theme default"}</small>
              <DesignInlineField key={config.editSession} config={{ value: entry.text, placeholder: config.readOnly ? "No meaning saved" : "Double-click to define meaning", optional: true, maxLength: 2000, label: `Meaning for ${legendKey(entry)}`, disabled: disabled || connecting, readOnly: config.readOnly, onStart: config.onDragStart, onEnd: config.onInteractionEnd, onSave: config.onSave, onCommit: (text) => config.onLegendMeaning(entry, text) }} />
            </div>
          </div>)}
          {!entries.some((entry) => entry.kind === kind) && <p className="loc">Only theme defaults in use.</p>}
        </section>)}
      </div>}
    </div>
    {!content.nodes.length && <p className="design-canvas-empty">{config.readOnly ? "This saved diagram has no steps." : content.kind === "swimlane" ? "Double-click inside a lane (or click +) to add a step. Double-click empty canvas to add a lane." : "Double-click the canvas to add a node. Right-click to add a group."}</p>}
    {connecting && <p className="design-canvas-hint" role="status">Choose the target node · Esc cancels</p>}
    {menu && <div className="design-context-menu" role="menu" aria-label="Canvas actions" ref={menuRef} style={{ left: menu.left, top: menu.top }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll("button")), index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}>
      {menuItems.map((item) => <button type="button" role="menuitem" key={item.label} onClick={() => { closeMenu(); item.run(); }}>{item.label}</button>)}
    </div>}
    <div className="design-zoom" role="group" aria-label="Canvas zoom">
      <button type="button" onClick={() => zoom(1.2)} aria-label="Zoom in">+</button><span>{Math.round(view.scale * 100)}%</span>
      <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">-</button><button type="button" onClick={fit}>Fit canvas</button>
    </div>
  </div>
  {openNode && <DesignNodeDrawer key={openNode.id} config={{
    node: openNode, readOnly: config.readOnly, onClose: () => setDrawerNode(undefined),
    onEdit: (field, value) => config.onEdit("node", openNode.id, field, value), onStart: config.onDragStart, onEnd: config.onInteractionEnd,
    onStatus: (status) => config.onNodeStatus(openNode.id, status), designId: config.designId, designIdLabel: config.designIdLabel,
    render: config.renderComment ?? ((text) => <p className="design-node-drawer-plain">{text}</p>), extras: config.renderNodeExtras?.(openNode.id, () => setDrawerNode(undefined)),
  }} />}
  </>;
}
