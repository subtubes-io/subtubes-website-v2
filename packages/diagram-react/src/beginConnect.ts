import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DiagramInstance } from './instance'

type Side = 'n' | 'e' | 's' | 'w'

export function sidePoint(node: { x: number; y: number; w: number; h: number }, side: Side) {
  if (side === 'n') return { x: node.x + node.w / 2, y: node.y }
  if (side === 's') return { x: node.x + node.w / 2, y: node.y + node.h }
  if (side === 'w') return { x: node.x, y: node.y + node.h / 2 }
  return { x: node.x + node.w, y: node.y + node.h / 2 }
}

// A pointer position on the screen as a position on the diagram.
export function toDiagram(instance: DiagramInstance, clientX: number, clientY: number) {
  const canvas = instance.surface.el?.getBoundingClientRect()
  const { x, y, scale } = instance.ui.viewport.getState()
  return { x: (clientX - (canvas?.left ?? 0) - x) / scale, y: (clientY - (canvas?.top ?? 0) - y) / scale }
}

const nodeUnder = (instance: DiagramInstance, clientX: number, clientY: number, not: string) => {
  const found = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-node-id]')
  // A node of another canvas on the same page is not a place to connect to.
  if (!found || (instance.surface.el && !instance.surface.el.contains(found))) return null
  const id = found.dataset.nodeId
  return id && id !== not ? id : null
}

// Drags an edge out of a node. Dropping it on another node connects them, as one undoable change;
// dropping anywhere else, or pressing Escape, does nothing.
export function beginConnect(instance: DiagramInstance, e: ReactPointerEvent, source: string, side: Side) {
  if (e.button !== 0) return
  // Without this the press would start a canvas pan.
  e.stopPropagation()
  e.preventDefault()
  const from = instance.controller.stores.nodes.getState().byId[source]
  if (!from) return

  const connect = instance.ui.connect
  connect.getState().start(source, side, toDiagram(instance, e.clientX, e.clientY))

  const onMove = (ev: PointerEvent) => connect.getState().move(toDiagram(instance, ev.clientX, ev.clientY), nodeUnder(instance, ev.clientX, ev.clientY, source))

  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    connect.getState().end()
  }

  const onUp = (ev: PointerEvent) => {
    const target = nodeUnder(instance, ev.clientX, ev.clientY, source)
    stop()
    if (target) connectNodes(instance, source, target)
  }

  const onCancel = () => stop()

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    ev.stopPropagation()
    stop()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
}

// Adds an unlabelled edge, or selects the one that is already there.
export function connectNodes(instance: DiagramInstance, from: string, to: string) {
  const { controller, ui } = instance
  const nodes = controller.stores.nodes.getState().byId
  const find = () => controller.getSnapshot().edges.find((edge) => edge.from === from && edge.to === to && edge.label === '')
  const found = find()
  if (found) {
    ui.selection.getState().select({ kind: 'edge', id: found.id })
    return
  }
  const result = controller.apply({
    ops: [{ op: 'createEdge', edge: { from, to, label: '' } }],
    summary: `Connect “${nodes[from]?.title ?? from}” → “${nodes[to]?.title ?? to}”`,
    source: 'user',
  })
  if (!result.ok) return
  const id = find()?.id
  if (id) ui.selection.getState().select({ kind: 'edge', id })
}
