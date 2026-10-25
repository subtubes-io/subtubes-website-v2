import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { DIAGRAM_SCHEMA_VERSION } from './format'
import type { DiagramOp } from './ops'
import { applyPatch, diffSnapshots, isEmptyPatch, planChanges } from './plan'
import type { Patch, Snapshot } from './plan'
import type { DiagramData, DiagramFile, EdgeDef, GroupDef, NodeDef } from './types'

// The diagram's state and the one way to change it. A host (the Subtubes app, another app, a test, a server) gets a controller, reads
// from it, and changes it only through `apply`: so a mouse, a keyboard shortcut and an AI agent all take the same path, and all get the
// same checks and the same exact inverse. The controller has no UI and no storage and keeps no history: a host that wants undo keeps the
// `inverse` of each change (`onChange`) and sends it back with `applyPatch`.

export interface NodeState {
  byId: Record<string, NodeDef>
  ids: string[]
  setNodes: (nodes: NodeDef[]) => void
  addNode: (node: NodeDef) => void
  updateNode: (id: string, patch: Partial<Omit<NodeDef, 'id'>>) => void
  removeNode: (id: string) => void
}

export interface EdgeState {
  byId: Record<string, EdgeDef>
  ids: string[]
  setEdges: (edges: EdgeDef[]) => void
  addEdge: (edge: EdgeDef) => void
  updateEdge: (id: string, patch: Partial<Omit<EdgeDef, 'id'>>) => void
  removeEdge: (id: string) => void
  // Returns the removed edge ids so callers can clear a stale selection.
  removeEdgesOfNode: (nodeId: string) => string[]
}

export interface GroupState {
  byId: Record<string, GroupDef>
  ids: string[]
  setGroups: (groups: GroupDef[]) => void
  addGroup: (group: GroupDef) => void
  updateGroup: (id: string, patch: Partial<Omit<GroupDef, 'id'>>) => void
  removeGroup: (id: string) => void
}

// What the diagram is, apart from its contents. The revision counts accepted changes (an undo counts too), so an agent, and any proposal it
// makes, can tell whether the diagram has moved on since it looked.
export interface MetaState {
  name: string
  description?: string
  type?: DiagramFile['type']
  revision: number
  setMeta: (meta: { name: string; description?: string; type?: DiagramFile['type']; revision?: number }) => void
  bumpRevision: () => number
}

// The stores a renderer subscribes to, one per kind so a component re-renders only for the kind it shows. A change from outside goes through
// `apply`; writing to a store directly is only for a live preview that is rolled back (a drag in progress).
export interface DiagramStores {
  nodes: StoreApi<NodeState>
  edges: StoreApi<EdgeState>
  groups: StoreApi<GroupState>
  meta: StoreApi<MetaState>
}

export interface DiagramSnapshot extends Snapshot {
  name: string
  description?: string
  type?: DiagramFile['type']
  revision: number
}

export interface ApplyRequest {
  ops: DiagramOp[]
  // A short description, for a history list or an approval card.
  summary: string
  // Who made the change: 'user', 'agent', or anything the host tells apart.
  source: string
  // The revision the author looked at. A mismatch means the diagram moved on and nothing is applied.
  expectedRevision?: number
  // The host's own id for the change (a tool call id, say); one is made when it is left out.
  id?: string
}

export type ApplyResult =
  | {
      ok: true
      revision: number
      // How many operations were in the batch.
      applied: number
      // False when the batch changed nothing (the revision did not move and no event was sent).
      changed: boolean
      patch: Patch
      // What undoes it exactly: only the things it touched. Send it to `applyPatch`.
      inverse: Patch
    }
  | { ok: false; error: 'stale-revision' | 'invalid'; message: string; currentRevision: number }

export interface ChangeEvent {
  id: string
  revision: number
  summary: string
  source: string
  at: number
  patch: Patch
  inverse: Patch
}

export interface DiagramController {
  readonly stores: DiagramStores
  // The whole diagram as plain data. The same object is returned until something changes, so it works with React's useSyncExternalStore.
  getSnapshot(): DiagramSnapshot
  // Called once after each change or load (not once per store write).
  subscribe(listener: () => void): () => void
  // The one way to change a diagram. A batch is applied as a whole or not at all, and moves the revision once.
  apply(request: ApplyRequest): ApplyResult
  // Applies a patch the host kept (an inverse, for undo) as a change of its own: the revision moves on.
  applyPatch(patch: Patch, meta: { summary: string; source: string; id?: string }): ApplyResult
  // Called for each accepted change that changed something, with what a history, an autosave or an approval list needs.
  onChange(listener: (event: ChangeEvent) => void): () => void
  // Called after a whole diagram is put in (a different one is shown).
  onLoad(listener: () => void): () => void
  // Replaces the contents. Not a change: it has no inverse and sends no ChangeEvent.
  load(diagram: DiagramData & { name?: string; description?: string }, revision?: number): void
  // The diagram as a file; pass it to serializeDiagram() to save it.
  export(meta?: { name?: string; description?: string; schemaVersion?: number }): DiagramFile
  // Runs several store writes and tells subscribers once, afterwards.
  batch(fn: () => void): void
}

function collection<T extends { id: string }>(set: (partial: Partial<{ byId: Record<string, T>; ids: string[] }>) => void) {
  return {
    replace: (items: T[]) => set({ byId: Object.fromEntries(items.map((i) => [i.id, i])), ids: items.map((i) => i.id) }),
  }
}

function makeStores(): DiagramStores {
  const nodes = createStore<NodeState>()((set) => ({
    byId: {},
    ids: [],
    setNodes: (items) => collection<NodeDef>(set).replace(items),
    addNode: (node) =>
      set((s) => ({
        byId: { ...s.byId, [node.id]: node },
        ids: s.ids.includes(node.id) ? s.ids : [...s.ids, node.id],
      })),
    updateNode: (id, patch) =>
      set((s) => {
        const current = s.byId[id]
        if (!current) return s
        return { byId: { ...s.byId, [id]: { ...current, ...patch } } }
      }),
    removeNode: (id) =>
      set((s) => {
        if (!s.byId[id]) return s
        const { [id]: _removed, ...byId } = s.byId
        return { byId, ids: s.ids.filter((i) => i !== id) }
      }),
  }))

  const edges = createStore<EdgeState>()((set, get) => ({
    byId: {},
    ids: [],
    setEdges: (items) => collection<EdgeDef>(set).replace(items),
    addEdge: (edge) =>
      set((s) => ({
        byId: { ...s.byId, [edge.id]: edge },
        ids: s.ids.includes(edge.id) ? s.ids : [...s.ids, edge.id],
      })),
    updateEdge: (id, patch) =>
      set((s) => {
        const current = s.byId[id]
        if (!current) return s
        return { byId: { ...s.byId, [id]: { ...current, ...patch } } }
      }),
    removeEdge: (id) =>
      set((s) => {
        if (!s.byId[id]) return s
        const { [id]: _removed, ...byId } = s.byId
        return { byId, ids: s.ids.filter((i) => i !== id) }
      }),
    removeEdgesOfNode: (nodeId) => {
      const { byId, ids } = get()
      const removed = ids.filter((id) => byId[id].from === nodeId || byId[id].to === nodeId)
      if (removed.length === 0) return removed
      const drop = new Set(removed)
      set({
        byId: Object.fromEntries(Object.entries(byId).filter(([id]) => !drop.has(id))),
        ids: ids.filter((id) => !drop.has(id)),
      })
      return removed
    },
  }))

  const groups = createStore<GroupState>()((set) => ({
    byId: {},
    ids: [],
    setGroups: (items) => collection<GroupDef>(set).replace(items),
    addGroup: (group) =>
      set((s) => ({
        byId: { ...s.byId, [group.id]: group },
        ids: s.ids.includes(group.id) ? s.ids : [...s.ids, group.id],
      })),
    updateGroup: (id, patch) =>
      set((s) => {
        const current = s.byId[id]
        if (!current) return s
        return { byId: { ...s.byId, [id]: { ...current, ...patch } } }
      }),
    removeGroup: (id) =>
      set((s) => {
        if (!s.byId[id]) return s
        const { [id]: _removed, ...byId } = s.byId
        return { byId, ids: s.ids.filter((i) => i !== id) }
      }),
  }))

  const meta = createStore<MetaState>()((set, get) => ({
    name: 'Untitled diagram',
    description: undefined,
    revision: 0,
    setMeta: ({ name, description, type, revision = 0 }) => set({ name, description, type, revision }),
    bumpRevision: () => {
      const next = get().revision + 1
      set({ revision: next })
      return next
    },
  }))

  return { nodes, edges, groups, meta }
}

let counter = 1

export function createDiagramController(initial?: DiagramData & { name?: string; description?: string; revision?: number }): DiagramController {
  const stores = makeStores()
  const listeners = new Set<() => void>()
  const changeListeners = new Set<(event: ChangeEvent) => void>()
  const loadListeners = new Set<() => void>()

  let snapshot: DiagramSnapshot | null = null
  let depth = 0
  let dirty = false
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  // Any write to any store (a commit, a load, or a live preview) ends up here.
  const touched = () => {
    snapshot = null
    if (depth > 0) dirty = true
    else notify()
  }
  for (const store of [stores.nodes, stores.edges, stores.groups, stores.meta]) (store as StoreApi<unknown>).subscribe(touched)

  const batch = (fn: () => void) => {
    depth++
    try {
      fn()
    } finally {
      depth--
      if (depth === 0 && dirty) {
        dirty = false
        notify()
      }
    }
  }

  const getSnapshot = (): DiagramSnapshot => {
    if (snapshot) return snapshot
    const nodes = stores.nodes.getState()
    const edges = stores.edges.getState()
    const groups = stores.groups.getState()
    const meta = stores.meta.getState()
    snapshot = {
      name: meta.name,
      description: meta.description,
      ...(meta.type && { type: meta.type }),
      revision: meta.revision,
      nodes: nodes.ids.map((id) => nodes.byId[id]),
      edges: edges.ids.map((id) => edges.byId[id]),
      groups: groups.ids.map((id) => groups.byId[id]),
    }
    return snapshot
  }

  // Positions of things a change did not touch are whatever they are now: the snapshot was just read from the stores.
  const commit = (next: Snapshot) => {
    batch(() => {
      stores.groups.getState().setGroups(next.groups)
      stores.nodes.getState().setNodes(next.nodes)
      stores.edges.getState().setEdges(next.edges)
    })
  }

  const empty: Patch = { nodes: { upsert: [], remove: [] }, edges: { upsert: [], remove: [] }, groups: { upsert: [], remove: [] } }

  const run = (planned: ReturnType<typeof planChanges>, request: { summary: string; source: string; id?: string }, applied: number): ApplyResult => {
    const currentRevision = stores.meta.getState().revision
    if (!planned.ok) return { ok: false, error: 'invalid', message: planned.message, currentRevision }
    // A batch that changes nothing is not a change.
    if (isEmptyPatch(planned.patch)) return { ok: true, revision: currentRevision, applied, changed: false, patch: empty, inverse: empty }

    let revision = currentRevision
    batch(() => {
      commit(planned.next)
      revision = stores.meta.getState().bumpRevision()
    })
    const event: ChangeEvent = {
      id: request.id ?? `change-${Date.now().toString(36)}-${counter++}`,
      revision,
      summary: request.summary,
      source: request.source,
      at: Date.now(),
      patch: planned.patch,
      inverse: planned.inverse,
    }
    for (const listener of [...changeListeners]) listener(event)
    return { ok: true, revision, applied, changed: true, patch: planned.patch, inverse: planned.inverse }
  }

  const controller: DiagramController = {
    stores,
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    apply(request) {
      const meta = stores.meta.getState()
      if (request.expectedRevision !== undefined && request.expectedRevision !== meta.revision) {
        return {
          ok: false,
          error: 'stale-revision',
          message: `The diagram is at revision ${meta.revision}, but this change was made against revision ${request.expectedRevision}. Read it again and retry.`,
          currentRevision: meta.revision,
        }
      }
      return run(planChanges(getSnapshot(), request.ops), request, request.ops.length)
    },
    applyPatch(patch, meta) {
      const before = getSnapshot()
      const next = applyPatch(before, patch)
      // What undoes this exactly is what turns the result back into what it was.
      return run({ ok: true, next, patch, inverse: diffSnapshots(next, before), applied: 1 }, meta, 1)
    },
    onChange(listener) {
      changeListeners.add(listener)
      return () => void changeListeners.delete(listener)
    },
    onLoad(listener) {
      loadListeners.add(listener)
      return () => void loadListeners.delete(listener)
    },
    load(diagram, revision = 0) {
      batch(() => {
        if (diagram.name) stores.meta.getState().setMeta({ name: diagram.name, description: diagram.description, type: diagram.type, revision })
        stores.groups.getState().setGroups(diagram.groups)
        stores.nodes.getState().setNodes(diagram.nodes)
        stores.edges.getState().setEdges(diagram.edges)
      })
      for (const listener of [...loadListeners]) listener()
    },
    export(meta) {
      const snap = getSnapshot()
      return {
        schemaVersion: (meta?.schemaVersion ?? DIAGRAM_SCHEMA_VERSION) as DiagramFile['schemaVersion'],
        name: meta?.name ?? snap.name,
        ...(snap.type && { type: snap.type }),
        ...((meta?.description ?? snap.description) !== undefined && { description: meta?.description ?? snap.description }),
        groups: snap.groups,
        nodes: snap.nodes,
        edges: snap.edges,
      }
    },
    batch,
  }

  if (initial) controller.load(initial, initial.revision ?? 0)
  return controller
}
