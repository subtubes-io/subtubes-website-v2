import type { PointerEvent as ReactPointerEvent } from 'react'
import { membersOf } from '@subtubes/diagram-core'
import type { DiagramInstance } from './instance'
import { dragRect, minSize, rectPatch } from '@subtubes/diagram-core'
import type { EditKind, EditMode, Rect } from '@subtubes/diagram-core'

// Below this many screen pixels a press is a click, not a drag.
const CLICK_SLOP = 3

const read = ({ controller }: DiagramInstance, kind: EditKind, id: string): (Rect & { title: string }) | undefined =>
  kind === 'node' ? controller.stores.nodes.getState().byId[id] : controller.stores.groups.getState().byId[id]

function write({ controller }: DiagramInstance, kind: EditKind, id: string, rect: Rect) {
  if (kind === 'node') controller.stores.nodes.getState().updateNode(id, rect)
  else controller.stores.groups.getState().updateGroup(id, rect)
}

// What goes along when a group moves: the nodes and groups inside it (the planner applies the same rule).
function carriedBy({ controller }: DiagramInstance, kind: EditKind, id: string, mode: EditMode) {
  if (kind !== 'group' || mode !== 'move') return { nodes: [], groups: [] }
  const snapshot = controller.getSnapshot()
  const group = snapshot.groups.find((g) => g.id === id)
  return group ? membersOf(group, snapshot.nodes, snapshot.groups) : { nodes: [], groups: [] }
}

// Starts moving or resizing a node or group. The drag previews live in the stores; when it ends the
// preview is rolled back and the result goes through the controller as ONE change, so it can be
// undone, moves the revision, and makes a proposal written before it stale. Escape cancels.
export function beginEdit(instance: DiagramInstance, e: ReactPointerEvent, kind: EditKind, id: string, mode: EditMode) {
  const { controller, ui } = instance
  if (e.button !== 0) return
  // Without this the press would start a canvas pan.
  e.stopPropagation()
  ui.selection.getState().select({ kind, id })

  const found = read(instance, kind, id)
  if (!found) return
  const { title } = found
  const start: Rect = { x: found.x, y: found.y, w: found.w, h: found.h }
  const scale = ui.viewport.getState().scale
  const origin = { x: e.clientX, y: e.clientY }
  let moved = false
  let latest = start
  const carried = carriedBy(instance, kind, id, mode)
  const carriedCount = carried.nodes.length + carried.groups.length

  const preview = (dx: number, dy: number) => {
    for (const n of carried.nodes) controller.stores.nodes.getState().updateNode(n.id, { x: n.x + dx, y: n.y + dy })
    for (const g of carried.groups) controller.stores.groups.getState().updateGroup(g.id, { x: g.x + dx, y: g.y + dy })
  }

  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - origin.x
    const dy = ev.clientY - origin.y
    if (!moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    moved = true
    latest = dragRect(start, mode, dx / scale, dy / scale, minSize(kind))
    write(instance, kind, id, latest)
    preview(latest.x - start.x, latest.y - start.y)
  }

  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
  }

  const onUp = () => {
    stop()
    const patch = rectPatch(start, latest)
    write(instance, kind, id, start)
    preview(0, 0)
    if (!moved || Object.keys(patch).length === 0) return
    const what = mode === 'move' ? 'Move' : 'Resize'
    controller.apply({
      ops: [kind === 'node' ? { op: 'updateNode', id, patch } : { op: 'updateGroup', id, patch }],
      summary: `${what} ${kind} “${title}”${carriedCount > 0 ? ` with what is inside it` : ''}`,
      source: 'user',
    })
  }

  const onCancel = () => {
    stop()
    write(instance, kind, id, start)
    preview(0, 0)
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    onCancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
}
