import { describe, expect, it } from 'vitest'
import { createDiagramController } from './controller'
import { parseDiagram, readDiagram, serializeDiagram } from './format'
import type { DiagramOp } from './ops'
import { membersOf } from './membership'

function setup(orientation: 'horizontal' | 'vertical' = 'horizontal') {
  const controller = createDiagramController({ name: 'Workflow', type: 'swimlane', groups: [], nodes: [], edges: [] })
  const apply = (ops: DiagramOp[]) => controller.apply({ ops, summary: 'Edit workflow', source: 'user' })
  expect(apply([
    { op: 'createLane', lane: { id: 'customer', title: 'Customer', body: 'Starts the request', orientation } },
    { op: 'createLane', lane: { id: 'service', title: 'Service', body: 'Handles it' } },
    { op: 'createNode', node: { id: 'request', title: 'Request', body: 'Editable **body**', laneId: 'customer' } },
    { op: 'createNode', node: { id: 'handle', title: 'Handle', body: 'Process the request', laneId: 'service' } },
    { op: 'createEdge', edge: { from: 'request', to: 'handle', label: 'submit' } },
  ]).ok).toBe(true)
  return { controller, apply }
}

describe('swimlanes', () => {
  it.each(['horizontal', 'vertical'] as const)('creates %s lanes with normal editable nodes and edges', (orientation) => {
    const { controller, apply } = setup(orientation)
    const snapshot = controller.getSnapshot()
    const [first, second] = snapshot.groups
    expect(first.lane).toEqual({ body: 'Starts the request', orientation })
    if (orientation === 'horizontal') expect(second.y).toBe(first.y + first.h)
    else expect(second.x).toBe(first.x + first.w)
    expect(membersOf(first, snapshot.nodes, []).nodes.map((n) => n.id)).toEqual(['request'])
    expect(membersOf(second, snapshot.nodes, []).nodes.map((n) => n.id)).toEqual(['handle'])
    expect(apply([
      { op: 'updateNode', id: 'request', patch: { title: 'Submit order', body: 'New body' } },
      { op: 'updateEdge', id: snapshot.edges[0].id, patch: { label: 'send' } },
      { op: 'updateLane', id: 'customer', patch: { title: 'Buyer', body: 'New description' } },
    ]).ok).toBe(true)
    expect(controller.getSnapshot().groups[0]).toMatchObject({ title: 'Buyer', lane: { body: 'New description' } })
    expect(controller.getSnapshot().nodes[0]).toMatchObject({ title: 'Submit order', body: 'New body' })
    expect(controller.getSnapshot().edges[0].label).toBe('send')
  })

  it('moves a lane together with its nodes and undoes exactly', () => {
    const { controller, apply } = setup()
    const before = controller.getSnapshot()
    const result = apply([{ op: 'updateLane', id: 'customer', patch: { x: 100, y: 40 } }])
    expect(result.ok).toBe(true)
    expect(controller.getSnapshot().nodes[0]).toMatchObject({ x: before.nodes[0].x + 100, y: before.nodes[0].y + 40 })
    expect(controller.getSnapshot().nodes[1]).toEqual(before.nodes[1])
    if (!result.ok) return
    controller.applyPatch(result.inverse, { summary: 'Undo', source: 'user' })
    expect(controller.getSnapshot()).toEqual({ ...before, revision: before.revision + 2 })
  })

  it('reorders and changes orientation while carrying nodes and preserving edges', () => {
    const { controller, apply } = setup()
    const before = controller.getSnapshot()
    expect(apply([{ op: 'arrangeLanes', orientation: 'vertical', laneIds: ['service', 'customer'] }]).ok).toBe(true)
    const next = controller.getSnapshot()
    const first = next.groups.find((g) => g.id === 'service')!
    const second = next.groups.find((g) => g.id === 'customer')!
    expect(first.x).toBeLessThan(second.x)
    expect(first.y).toBe(second.y)
    expect(first.h).toBe(second.h)
    expect(first.h).toBeGreaterThanOrEqual(720)
    expect(first.w).toBe(400)
    expect(second.w).toBe(400)
    expect(membersOf(first, next.nodes, []).nodes.map((n) => n.id)).toEqual(['handle'])
    expect(membersOf(second, next.nodes, []).nodes.map((n) => n.id)).toEqual(['request'])
    expect(next.edges).toEqual(before.edges)
  })

  it('expands a lane to contain new nodes, without altering unrelated lanes', () => {
    const { controller, apply } = setup('vertical')
    const before = controller.getSnapshot().groups[1]
    expect(apply([{ op: 'createNode', node: { title: 'Another', body: '', laneId: 'customer', x: 800, y: 900 } }]).ok).toBe(true)
    const snapshot = controller.getSnapshot()
    expect(snapshot.groups[0].w).toBeGreaterThan(1000)
    expect(snapshot.groups[0].h).toBeGreaterThan(1000)
    expect(snapshot.groups[1]).toEqual(before)
    expect(membersOf(snapshot.groups[0], snapshot.nodes, []).nodes.some((n) => n.title === 'Another')).toBe(true)
  })

  it('deletes only the lane, keeping nodes and edges, and retains the design type with no lanes', () => {
    const { controller, apply } = setup()
    const before = controller.getSnapshot()
    expect(apply([{ op: 'deleteLane', id: 'customer' }, { op: 'deleteLane', id: 'service' }]).ok).toBe(true)
    expect(controller.export()).toMatchObject({ type: 'swimlane', groups: [], nodes: before.nodes, edges: before.edges })
    const saved = parseDiagram(JSON.parse(serializeDiagram(controller.export())))
    const reloaded = createDiagramController(saved)
    expect(reloaded.export().type).toBe('swimlane')
  })

  it.each(([
    [{ op: 'arrangeLanes', orientation: 'vertical', laneIds: ['customer', 'customer'] }],
    [{ op: 'arrangeLanes', orientation: 'vertical', laneIds: ['customer'] }],
    [{ op: 'createNode', node: { title: 'Bad', body: '', laneId: 'missing' } }],
    [{ op: 'updateLane', id: 'customer', patch: { title: ' ' } }],
    [{ op: 'createLane', lane: { title: 'Bad', body: '', orientation: 'vertical' } }],
  ] satisfies DiagramOp[][]).map((ops) => ({ ops })))('refuses invalid lane operations atomically: $ops', ({ ops }) => {
    const { controller, apply } = setup()
    const before = controller.export()
    expect(apply([{ op: 'updateNode', id: 'request', patch: { title: 'Must not change' } }, ...ops]).ok).toBe(false)
    expect(controller.export()).toEqual(before)
  })

  it('round-trips lane geometry and descriptions and upgrades old system diagrams', () => {
    const { controller } = setup('vertical')
    const saved = controller.export()
    expect(parseDiagram(JSON.parse(serializeDiagram(saved)))).toEqual(saved)
    const old = readDiagram({ schemaVersion: 2, name: 'Old', groups: [], nodes: [], edges: [] })
    expect(old).toMatchObject({ ok: true, upgraded: true, value: { schemaVersion: 3, name: 'Old' } })
  })
})
