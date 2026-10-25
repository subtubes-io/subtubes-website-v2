import type { DiagramController } from '@subtubes/diagram-core'

// What a person does on the canvas, as changes to the diagram: each is one `apply`, with source 'user', so it is one undoable change in
// whatever history the host keeps, and a proposal an agent wrote before it goes stale.

const NEW_NODE = { w: 280, h: 150 }
const NEW_GROUP = { w: 360, h: 240 }

// Adds a node centred on a point, and returns its id.
export function addNodeAt(controller: DiagramController, x: number, y: number, laneId?: string, onError?: (message: string) => void): string | undefined {
  const before = new Set(controller.getSnapshot().nodes.map((n) => n.id))
  const result = controller.apply({
    ops: [{ op: 'createNode', node: { title: 'New node', body: '', x: Math.round(x - NEW_NODE.w / 2), y: Math.round(y - NEW_NODE.h / 2), ...(laneId && { laneId }) } }],
    summary: 'Add node',
    source: 'user',
  })
  if (!result.ok) {
    onError?.(result.message)
    return undefined
  }
  return controller.getSnapshot().nodes.find((n) => !before.has(n.id))?.id
}

// Adds an empty group (a labelled box) centred on a point, and returns its id.
export function addGroupAt(controller: DiagramController, x: number, y: number): string | undefined {
  const before = new Set(controller.getSnapshot().groups.map((g) => g.id))
  const result = controller.apply({
    ops: [{ op: 'createGroup', group: { title: 'New group', nodeIds: [], x: Math.round(x - NEW_GROUP.w / 2), y: Math.round(y - NEW_GROUP.h / 2), w: NEW_GROUP.w, h: NEW_GROUP.h } }],
    summary: 'Add group',
    source: 'user',
  })
  if (!result.ok) return undefined
  return controller.getSnapshot().groups.find((g) => !before.has(g.id))?.id
}

// A node takes its edges with it.
export function deleteNode(controller: DiagramController, id: string) {
  const title = controller.stores.nodes.getState().byId[id]?.title ?? id
  controller.apply({ ops: [{ op: 'deleteNode', id }], summary: `Delete node “${title}”`, source: 'user' })
}

// Only the box goes; the nodes it was drawn around stay.
export function deleteGroup(controller: DiagramController, id: string) {
  const title = controller.stores.groups.getState().byId[id]?.title ?? id
  controller.apply({ ops: [{ op: 'deleteGroup', id }], summary: `Delete group “${title}”`, source: 'user' })
}

export function deleteEdge(controller: DiagramController, id: string) {
  const label = controller.stores.edges.getState().byId[id]?.label
  controller.apply({ ops: [{ op: 'deleteEdge', id }], summary: `Delete edge${label ? ` “${label}”` : ''}`, source: 'user' })
}
