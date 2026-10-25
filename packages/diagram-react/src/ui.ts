import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { Bounds, EdgeHighlight, Highlights, NodeHighlight, Selection, Size } from '@subtubes/diagram-core'

// What the canvas keeps about how it is being used, apart from the diagram: where it is panned to, what is selected, what is being edited
// in place, what is being connected, and what is highlighted. One set for each canvas, so two diagrams can be on a page. None of it is part
// of the document and none of it is saved.

// ---- viewport ----

export const MIN_SCALE = 0.2
export const MAX_SCALE = 2
const PADDING = 48
const INITIAL_MIN_SCALE = 0.5
// Leaves room for the title bar when the diagram first opens.
const INITIAL_TOP_OFFSET = 40

export interface ViewportState {
  x: number
  y: number
  scale: number
  panning: boolean
  setPanning: (panning: boolean) => void
  setPosition: (x: number, y: number) => void
  panBy: (dx: number, dy: number) => void
  zoomAround: (factor: number, cx: number, cy: number) => void
  fit: (size: Size, bounds: Bounds) => void
  reset: (size: Size, bounds: Bounds) => void
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function fitScale(size: Size, bounds: Bounds, min: number) {
  if (bounds.w === 0 || bounds.h === 0) return 1
  return clamp(Math.min((size.width - PADDING * 2) / bounds.w, (size.height - PADDING * 2) / bounds.h), min, MAX_SCALE)
}

export const createViewportStore = () =>
  createStore<ViewportState>()((set) => ({
    x: PADDING,
    y: PADDING,
    scale: INITIAL_MIN_SCALE,
    panning: false,
    setPanning: (panning) => set({ panning }),
    setPosition: (x, y) => set({ x, y }),
    panBy: (dx, dy) => set((s) => ({ x: s.x + dx, y: s.y + dy })),
    zoomAround: (factor, cx, cy) =>
      set((s) => {
        const scale = clamp(s.scale * factor, MIN_SCALE, MAX_SCALE)
        const k = scale / s.scale
        return { scale, x: cx - (cx - s.x) * k, y: cy - (cy - s.y) * k }
      }),
    // Whole diagram visible and centered.
    fit: (size, bounds) => {
      const scale = fitScale(size, bounds, MIN_SCALE)
      set({ scale, x: (size.width - bounds.w * scale) / 2, y: (size.height - bounds.h * scale) / 2 })
    },
    // Readable starting view: never below the initial minimum, anchored top-left.
    reset: (size, bounds) => set({ scale: fitScale(size, bounds, INITIAL_MIN_SCALE), x: PADDING, y: PADDING + INITIAL_TOP_OFFSET }),
  }))

// ---- selection ----

export interface SelectionState {
  selection: Selection | null
  select: (selection: Selection) => void
  clearSelection: () => void
}

export const createSelectionStore = () =>
  createStore<SelectionState>()((set) => ({
    selection: null,
    select: (selection) => set({ selection }),
    clearSelection: () => set((s) => (s.selection ? { selection: null } : s)),
  }))

// ---- editing in place: one node (its title and content), one edge (its label) or one group (its title) ----

export interface EditState {
  node: { id: string; field: 'title' | 'body' } | null
  edge: string | null
  group: string | null
  editNode: (id: string, field: 'title' | 'body') => void
  editEdge: (id: string) => void
  editGroup: (id: string) => void
  end: () => void
}

export const createEditStore = () =>
  createStore<EditState>()((set) => ({
    node: null,
    edge: null,
    group: null,
    editNode: (id, field) => set({ node: { id, field }, edge: null, group: null }),
    editEdge: (id) => set({ edge: id, node: null, group: null }),
    editGroup: (id) => set({ group: id, node: null, edge: null }),
    end: () => set((s) => (s.node || s.edge || s.group ? { node: null, edge: null, group: null } : s)),
  }))

// ---- connecting: dragging an edge out of a node ----

export interface ConnectState {
  // The node the pointer is over (or just left), whose connect handles are showing.
  hovered: string | null
  // While an edge is being dragged out: where it started, the pointer in diagram units, and the node it would land on.
  source: string | null
  side: 'n' | 'e' | 's' | 'w'
  cursor: { x: number; y: number } | null
  target: string | null
  hover: (id: string) => void
  leave: () => void
  start: (source: string, side: ConnectState['side'], cursor: { x: number; y: number }) => void
  move: (cursor: { x: number; y: number }, target: string | null) => void
  end: () => void
}

// Moving from a node to its handles leaves the node for a moment; hiding is delayed so they don't vanish.
const LEAVE_DELAY = 250

export const createConnectStore = () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return createStore<ConnectState>()((set) => ({
    hovered: null,
    source: null,
    side: 'e',
    cursor: null,
    target: null,
    hover: (id) => {
      cancel()
      set((s) => (s.hovered === id ? s : { hovered: id }))
    },
    leave: () => {
      cancel()
      timer = setTimeout(() => set({ hovered: null }), LEAVE_DELAY)
    },
    start: (source, side, cursor) => {
      cancel()
      set({ source, side, cursor, target: null })
    },
    move: (cursor, target) => set({ cursor, target }),
    end: () => set({ source: null, cursor: null, target: null }),
  }))
}

// ---- highlights ----

// The kinds of highlight, and their shape, are @subtubes/diagram-core's (highlights.ts): what produces them and the canvas share them there.
export interface HighlightState {
  nodes: Record<string, NodeHighlight>
  edges: Record<string, EdgeHighlight>
  dimmed: boolean
  set: (highlights: Highlights) => void
  clear: () => void
}

const NO_HIGHLIGHTS = { nodes: {}, edges: {}, dimmed: false }

export const createHighlightStore = () =>
  createStore<HighlightState>()((set) => ({
    ...NO_HIGHLIGHTS,
    set: ({ nodes, edges, dimmed = false }) => set({ nodes, edges, dimmed }),
    clear: () => set((s) => (s.dimmed || Object.keys(s.nodes).length || Object.keys(s.edges).length ? NO_HIGHLIGHTS : s)),
  }))

// ---- all of them ----

export interface CanvasUi {
  viewport: StoreApi<ViewportState>
  selection: StoreApi<SelectionState>
  edit: StoreApi<EditState>
  connect: StoreApi<ConnectState>
  highlight: StoreApi<HighlightState>
}

export const createCanvasUi = (): CanvasUi => ({
  viewport: createViewportStore(),
  selection: createSelectionStore(),
  edit: createEditStore(),
  connect: createConnectStore(),
  highlight: createHighlightStore(),
})
