import { membersOf } from './membership'
import type { DiagramOp } from './ops'
import type { EdgeDef, GroupDef, NodeDef } from './types'

// The part of the app that edits a diagram, kept pure: given what the diagram is and a batch of
// operations, say what it becomes (or why that is not possible). Nothing here touches a store,
// so every rule can be tested on its own, and a batch is all-or-nothing by construction.

export interface Snapshot {
  nodes: NodeDef[]
  edges: EdgeDef[]
  groups: GroupDef[]
}

// A change to a snapshot: entities to put in (new or replaced) and ids to take out. Applying a
// patch touches only the entities named in it, so undoing a change does not undo unrelated
// edits (a node the user dragged afterwards, say).
export interface Patch {
  nodes: { upsert: NodeDef[]; remove: string[] }
  edges: { upsert: EdgeDef[]; remove: string[] }
  groups: { upsert: GroupDef[]; remove: string[] }
}

export type PlanResult =
  | { ok: true; next: Snapshot; patch: Patch; inverse: Patch; applied: number }
  | { ok: false; message: string; opIndex?: number }

export const LIMITS = { maxNodes: 300, maxEdges: 600, maxGroups: 50, title: 120, body: 20_000, label: 200 } as const

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const DEFAULT_SIZE = { w: 280, h: 150 }
const ROW_GAP = 30
const GROUP_BOTTOM_PADDING = 20
// An empty group, before it is sized.
const EMPTY_GROUP = { w: 360, h: 240 }
const GROUP_PADDING = 24
const GROUP_TITLE_SPACE = 40

function diffById<T extends { id: string }>(before: T[], after: T[]): { upsert: T[]; remove: string[] } {
  const beforeById = new Map(before.map((e) => [e.id, e]))
  const afterIds = new Set(after.map((e) => e.id))
  return {
    upsert: after.filter((e) => JSON.stringify(beforeById.get(e.id)) !== JSON.stringify(e)),
    remove: before.filter((e) => !afterIds.has(e.id)).map((e) => e.id),
  }
}

// What turns `before` into `after`.
export function diffSnapshots(before: Snapshot, after: Snapshot): Patch {
  return {
    nodes: diffById(before.nodes, after.nodes),
    edges: diffById(before.edges, after.edges),
    groups: diffById(before.groups, after.groups),
  }
}

function applyTo<T extends { id: string }>(items: T[], change: { upsert: T[]; remove: string[] }): T[] {
  const removed = new Set(change.remove)
  const replacements = new Map(change.upsert.map((e) => [e.id, e]))
  const kept = items.filter((e) => !removed.has(e.id)).map((e) => replacements.get(e.id) ?? e)
  const known = new Set(items.map((e) => e.id))
  return [...kept, ...change.upsert.filter((e) => !known.has(e.id))]
}

export function applyPatch(snapshot: Snapshot, patch: Patch): Snapshot {
  const nodes = applyTo(snapshot.nodes, patch.nodes)
  const nodeIds = new Set(nodes.map((n) => n.id))
  return {
    nodes,
    // An edge whose end is gone cannot exist.
    edges: applyTo(snapshot.edges, patch.edges).filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)),
    groups: applyTo(snapshot.groups, patch.groups),
  }
}

export function isEmptyPatch(patch: Patch): boolean {
  return Object.values(patch).every((c) => c.upsert.length === 0 && c.remove.length === 0)
}

function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'item'
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

class PlanError extends Error {}

// A colour is set, or taken off with null; left out, it stays.
function setColor(item: { color?: string }, color: string | null | undefined) {
  if (color === null) delete item.color
  else if (color !== undefined) item.color = color
}
const fail = (message: string): never => {
  throw new PlanError(message)
}

// Puts a new node under the others in the column of the node added last. If that node is inside a box (a group), the box grows
// to keep the new one inside.
function place(draft: Snapshot, size: { w: number; h: number }) {
  const last = draft.nodes[draft.nodes.length - 1]
  if (!last) return { x: 0, y: ROW_GAP }

  const column = draft.nodes.filter((n) => n.x === last.x)
  const y = Math.max(...column.map((n) => n.y + n.h)) + ROW_GAP
  const home = draft.groups.find((g) => last.x >= g.x && last.x < g.x + g.w && last.y >= g.y && last.y < g.y + g.h)
  if (home) {
    const needed = y + size.h + GROUP_BOTTOM_PADDING - home.y
    if (needed > home.h) draft.groups = draft.groups.map((g) => (g.id === home.id ? { ...g, h: needed } : g))
  }
  return { x: last.x, y }
}

// The smallest a node or group may be resized to, so it cannot collapse out of sight.
export const MIN_NODE = { w: 160, h: 80 } as const
export const MIN_GROUP = { w: 120, h: 80 } as const

function checkSize(what: string, w: number | undefined, h: number | undefined, min: { w: number; h: number }) {
  if (w !== undefined && w < min.w) fail(`The ${what} cannot be narrower than ${min.w}.`)
  if (h !== undefined && h < min.h) fail(`The ${what} cannot be shorter than ${min.h}.`)
}

// Only the fields that were given.
function geometry(g: { x?: number; y?: number; w?: number; h?: number }) {
  return Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)) as Partial<{ x: number; y: number; w: number; h: number }>
}

function checkText(label: string, value: string, max: number) {
  if (value.length > max) fail(`${label} is too long (${value.length} characters; the limit is ${max}).`)
}

function node(draft: Snapshot, id: string): NodeDef {
  return draft.nodes.find((n) => n.id === id) ?? fail(`There is no node "${id}". Use getDiagram to see the ids.`)
}

// A node named by its id, or (for what the assistant has just created and has no id for yet) by its
// title, when exactly one node has it. A title that fits several nodes is refused rather than guessed.
export function findNodeRef(nodes: NodeDef[], ref: string): { node: NodeDef } | { error: 'missing' | 'ambiguous' } {
  const byId = nodes.find((n) => n.id === ref)
  if (byId) return { node: byId }
  for (const same of [(n: NodeDef) => n.title === ref, (n: NodeDef) => n.title.toLowerCase() === ref.toLowerCase()]) {
    const found = nodes.filter(same)
    if (found.length === 1) return { node: found[0] }
    if (found.length > 1) return { error: 'ambiguous' }
  }
  return { error: 'missing' }
}

function nodeRef(draft: Snapshot, ref: string): NodeDef {
  const found = findNodeRef(draft.nodes, ref)
  if ('node' in found) return found.node
  if (found.error === 'ambiguous') return fail(`More than one node is titled "${ref}". Use the node's id.`)
  return fail(`There is no node "${ref}". Use getDiagram to see the ids.`)
}

function group(draft: Snapshot, id: string): GroupDef {
  return draft.groups.find((g) => g.id === id) ?? fail(`There is no group "${id}". Use getDiagram to see the ids.`)
}

function edge(draft: Snapshot, id: string): EdgeDef {
  return draft.edges.find((e) => e.id === id) ?? fail(`There is no edge "${id}". Use getDiagram to see the ids.`)
}

function applyOp(draft: Snapshot, op: DiagramOp) {
  switch (op.op) {
    case 'createLane': {
      const lanes = draft.groups.filter((g) => g.lane)
      const orientation = op.lane.orientation ?? lanes[0]?.lane?.orientation ?? 'horizontal'
      if (!op.lane.title.trim()) fail('A swimlane title cannot be empty.')
      if (lanes.some((g) => g.lane?.orientation !== orientation)) fail('Use arrangeLanes to change the orientation of all swimlanes together.')
      const x = orientation === 'horizontal' ? Math.min(0, ...lanes.map((g) => g.x)) : Math.max(0, ...lanes.map((g) => g.x + g.w))
      const y = orientation === 'vertical' ? Math.min(0, ...lanes.map((g) => g.y)) : Math.max(0, ...lanes.map((g) => g.y + g.h))
      checkText('The lane description', op.lane.body, LIMITS.body)
      applyOp(draft, { op: 'createGroup', group: {
        ...op.lane, nodeIds: [], x: op.lane.x ?? x, y: op.lane.y ?? y,
        w: op.lane.w ?? (orientation === 'horizontal' ? Math.max(960, ...lanes.map((g) => g.w)) : 400),
        h: op.lane.h ?? (orientation === 'vertical' ? Math.max(720, ...lanes.map((g) => g.h)) : 280),
      } })
      draft.groups = draft.groups.map((g, index) => index === draft.groups.length - 1 ? { ...g, lane: { body: op.lane.body, orientation } } : g)
      return
    }
    case 'updateLane': {
      const current = group(draft, op.id)
      if (!current.lane) fail(`"${op.id}" is not a swimlane.`)
      const { body, ...patch } = op.patch
      if (patch.title !== undefined && !patch.title.trim()) fail('A swimlane title cannot be empty.')
      if (body !== undefined) checkText('The lane description', body, LIMITS.body)
      if (Object.values(patch).some((value) => value !== undefined)) applyOp(draft, { op: 'updateGroup', id: op.id, patch })
      else if (body === undefined) fail('The lane update changes nothing.')
      if (body !== undefined) draft.groups = draft.groups.map((g) => g.id === op.id && g.lane ? { ...g, lane: { ...g.lane, body } } : g)
      return
    }
    case 'deleteLane': {
      if (!group(draft, op.id).lane) fail(`"${op.id}" is not a swimlane.`)
      applyOp(draft, { op: 'deleteGroup', id: op.id })
      return
    }
    case 'arrangeLanes': {
      const lanes = draft.groups.filter((g) => g.lane).sort((a, b) => (a.lane?.orientation === 'vertical' ? a.x - b.x : a.y - b.y))
      if (lanes.length === 0) fail('There are no swimlanes to arrange.')
      const ids = op.laneIds ?? lanes.map((g) => g.id)
      if (ids.length !== lanes.length || new Set(ids).size !== lanes.length || ids.some((id) => !lanes.some((g) => g.id === id))) {
        fail('laneIds must contain every swimlane id exactly once.')
      }
      const ordered = ids.map((id) => group(draft, id))
      const x = Math.min(...lanes.map((g) => g.x))
      const y = Math.min(...lanes.map((g) => g.y))
      const sized = ordered.map((g) => {
        if (g.lane?.orientation === op.orientation) return g
        const nodes = membersOf(g, draft.nodes, []).nodes
        return { ...g,
          w: op.orientation === 'horizontal' ? Math.max(960, g.w) : Math.max(400, ...nodes.map((n) => n.x + n.w - g.x + 24)),
          h: op.orientation === 'vertical' ? Math.max(720, g.h) : Math.max(280, ...nodes.map((n) => n.y + n.h - g.y + 24)),
        }
      })
      const width = Math.max(...sized.map((g) => g.w))
      const height = Math.max(...sized.map((g) => g.h))
      let offset = 0
      const positions = new Map(sized.map((g) => {
        const next = { ...g, x: x + (op.orientation === 'vertical' ? offset : 0), y: y + (op.orientation === 'horizontal' ? offset : 0),
          w: op.orientation === 'horizontal' ? width : g.w, h: op.orientation === 'vertical' ? height : g.h,
          lane: { body: g.lane!.body, orientation: op.orientation } }
        offset += op.orientation === 'horizontal' ? next.h : next.w
        return [g.id, next]
      }))
      const moves = new Map<string, { dx: number; dy: number }>()
      for (const g of lanes) {
        const next = positions.get(g.id)!
        for (const n of membersOf(g, draft.nodes, []).nodes) {
          if (!moves.has(n.id)) moves.set(n.id, { dx: next.x - g.x, dy: next.y - g.y })
        }
      }
      draft.nodes = draft.nodes.map((n) => {
        const move = moves.get(n.id)
        return move ? { ...n, x: n.x + move.dx, y: n.y + move.dy } : n
      })
      draft.groups = draft.groups.map((g) => positions.get(g.id) ?? g)
      return
    }
    case 'createNode': {
      const { node: spec } = op
      checkText('The title', spec.title, LIMITS.title)
      checkText('The body', spec.body, LIMITS.body)
      if (draft.nodes.length >= LIMITS.maxNodes) fail(`The diagram already has the maximum of ${LIMITS.maxNodes} nodes.`)

      const taken = new Set(draft.nodes.map((n) => n.id))
      if (spec.id !== undefined && !ID_PATTERN.test(spec.id)) {
        fail(`"${spec.id}" is not a valid id. Use letters, digits, "-" and "_", starting with a letter or digit.`)
      }
      if (spec.id !== undefined && taken.has(spec.id)) fail(`A node with id "${spec.id}" already exists.`)
      const id = spec.id ?? uniqueId(slug(spec.title), taken)

      const size = { ...DEFAULT_SIZE }
      let at = spec.x !== undefined && spec.y !== undefined ? { x: spec.x, y: spec.y } : spec.laneId !== undefined ? { x: 0, y: 0 } : place(draft, size)
      if (spec.laneId !== undefined) {
        const lane = group(draft, spec.laneId)
        if (!lane.lane) fail(`"${spec.laneId}" is not a swimlane.`)
        const members = membersOf(lane, draft.nodes, []).nodes
        at = {
          x: Math.max(lane.x + 24, spec.x ?? lane.x + 24),
          y: Math.max(lane.y + 96, spec.y ?? Math.max(lane.y + 96, ...members.map((n) => n.y + n.h + 24))),
        }
        draft.groups = draft.groups.map((g) => g.id === lane.id ? { ...g, w: Math.max(g.w, at.x + size.w + 24 - g.x), h: Math.max(g.h, at.y + size.h + 24 - g.y) } : g)
      }
      draft.nodes = [...draft.nodes, { id, title: spec.title, body: spec.body, ...(spec.color !== undefined && { color: spec.color }), ...at, ...size }]
      return
    }

    case 'updateNode': {
      const current = node(draft, op.id)
      const { title, body, color, x, y, w, h } = op.patch
      if (Object.values(op.patch).every((v) => v === undefined)) fail(`The update to "${op.id}" changes nothing.`)
      if (title !== undefined) checkText('The title', title, LIMITS.title)
      if (body !== undefined) checkText('The body', body, LIMITS.body)
      checkSize(`node "${op.id}"`, w, h, MIN_NODE)

      const next: NodeDef = { ...current, ...(title !== undefined && { title }), ...(body !== undefined && { body }) }
      setColor(next, color)
      Object.assign(next, geometry({ x, y, w, h }))
      draft.nodes = draft.nodes.map((n) => (n.id === op.id ? next : n))
      return
    }

    case 'deleteNode': {
      node(draft, op.id)
      draft.nodes = draft.nodes.filter((n) => n.id !== op.id)
      // Its edges go with it.
      draft.edges = draft.edges.filter((e) => e.from !== op.id && e.to !== op.id)
      return
    }

    case 'createGroup': {
      const { group: spec } = op
      checkText('The title', spec.title, LIMITS.title)
      if (draft.groups.length >= LIMITS.maxGroups) fail(`The diagram already has the maximum of ${LIMITS.maxGroups} groups.`)
      const members = [...new Set(spec.nodeIds.map((ref) => nodeRef(draft, ref).id))].map((id) => node(draft, id))
      if (members.length === 0 && (spec.x === undefined || spec.y === undefined)) fail('A group needs nodes to go around, or a position (x and y) for an empty box.')
      checkSize('group', spec.w, spec.h, MIN_GROUP)
      const taken = new Set(draft.groups.map((g) => g.id))
      if (spec.id !== undefined && !ID_PATTERN.test(spec.id)) fail(`"${spec.id}" is not a valid id.`)
      if (spec.id !== undefined && taken.has(spec.id)) fail(`A group with id "${spec.id}" already exists.`)
      const id = spec.id ?? uniqueId(slug(spec.title), taken)

      if (members.length === 0) {
        draft.groups = [
          ...draft.groups,
          { id, title: spec.title, ...(spec.color !== undefined && { color: spec.color }), x: spec.x!, y: spec.y!, w: spec.w ?? EMPTY_GROUP.w, h: spec.h ?? EMPTY_GROUP.h },
        ]
        return
      }

      // The box is drawn around its nodes; moving nodes later does not move it.
      const left = Math.min(...members.map((n) => n.x)) - GROUP_PADDING
      const top = Math.min(...members.map((n) => n.y)) - GROUP_TITLE_SPACE
      const right = Math.max(...members.map((n) => n.x + n.w)) + GROUP_PADDING
      const bottom = Math.max(...members.map((n) => n.y + n.h)) + GROUP_PADDING
      draft.groups = [
        ...draft.groups,
        { id, title: spec.title, ...(spec.color !== undefined && { color: spec.color }), x: left, y: top, w: right - left, h: bottom - top },
      ]
      return
    }

    case 'updateGroup': {
      const current = group(draft, op.id)
      const { title, color, x, y, w, h } = op.patch
      if (Object.values(op.patch).every((v) => v === undefined)) fail(`The update to group "${op.id}" changes nothing.`)
      if (title !== undefined) checkText('The title', title, LIMITS.title)
      checkSize(`group "${op.id}"`, w, h, MIN_GROUP)

      // Changing only the position moves the group: what is inside it goes along. Giving a size resizes the box alone.
      const dx = w === undefined && h === undefined && x !== undefined ? x - current.x : 0
      const dy = w === undefined && h === undefined && y !== undefined ? y - current.y : 0
      const carried = dx !== 0 || dy !== 0 ? membersOf(current, draft.nodes, draft.groups) : { nodes: [], groups: [] }
      const carriedNodes = new Set(carried.nodes.map((n) => n.id))
      const carriedGroups = new Set(carried.groups.map((g) => g.id))
      draft.nodes = draft.nodes.map((n) => (carriedNodes.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n))
      draft.groups = draft.groups.map((g) => {
        if (g.id === current.id) {
          const next = { ...g, ...(title !== undefined && { title }), ...geometry({ x, y, w, h }) }
          setColor(next, color)
          return next
        }
        return carriedGroups.has(g.id) ? { ...g, x: g.x + dx, y: g.y + dy } : g
      })
      return
    }

    case 'deleteGroup': {
      group(draft, op.id)
      draft.groups = draft.groups.filter((g) => g.id !== op.id)
      return
    }

    case 'createEdge': {
      const { edge: spec } = op
      checkText('The label', spec.label, LIMITS.label)
      if (draft.edges.length >= LIMITS.maxEdges) fail(`The diagram already has the maximum of ${LIMITS.maxEdges} edges.`)
      // Ends may be named by id or by title, so an edge can follow the nodes created earlier in the same batch.
      const from = nodeRef(draft, spec.from).id
      const to = nodeRef(draft, spec.to).id
      if (from === to) fail('An edge cannot start and end at the same node.')
      if (draft.edges.some((e) => e.from === from && e.to === to && e.label === spec.label)) {
        fail(`There is already an edge from "${from}" to "${to}" labelled "${spec.label}".`)
      }

      const taken = new Set(draft.edges.map((e) => e.id))
      if (spec.id !== undefined && !ID_PATTERN.test(spec.id)) fail(`"${spec.id}" is not a valid id.`)
      if (spec.id !== undefined && taken.has(spec.id)) fail(`An edge with id "${spec.id}" already exists.`)
      const id = spec.id ?? uniqueId(`${slug(from)}-${slug(to)}`, taken)

      draft.edges = [
        ...draft.edges,
        {
          id,
          from,
          to,
          label: spec.label,
          ...(spec.dashed !== undefined && { dashed: spec.dashed }),
          ...(spec.optional !== undefined && { optional: spec.optional }),
          ...(spec.color !== undefined && { color: spec.color }),
        },
      ]
      return
    }

    case 'updateEdge': {
      const current = edge(draft, op.id)
      const { label, dashed, optional, color } = op.patch
      if (Object.values(op.patch).every((v) => v === undefined)) fail(`The update to "${op.id}" changes nothing.`)
      if (label !== undefined) checkText('The label', label, LIMITS.label)
      draft.edges = draft.edges.map((e) => {
        if (e.id !== current.id) return e
        const next = { ...e, ...(label !== undefined && { label }), ...(dashed !== undefined && { dashed }), ...(optional !== undefined && { optional }) }
        setColor(next, color)
        return next
      })
      return
    }

    case 'deleteEdge': {
      edge(draft, op.id)
      draft.edges = draft.edges.filter((e) => e.id !== op.id)
      return
    }
  }
}

// Applies the operations in order to a copy. If any one is invalid, nothing is applied and the
// reason names the operation, so the model can fix that one and try again.
export function planChanges(snapshot: Snapshot, ops: DiagramOp[]): PlanResult {
  const draft: Snapshot = { nodes: [...snapshot.nodes], edges: [...snapshot.edges], groups: [...snapshot.groups] }

  for (let i = 0; i < ops.length; i++) {
    try {
      applyOp(draft, ops[i])
    } catch (error) {
      if (error instanceof PlanError) return { ok: false, message: `Change ${i + 1} (${ops[i].op}): ${error.message}`, opIndex: i }
      throw error
    }
  }

  const patch = diffSnapshots(snapshot, draft)
  return { ok: true, next: draft, patch, inverse: diffSnapshots(draft, snapshot), applied: ops.length }
}
