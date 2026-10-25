import { describe, expect, it } from 'vitest'
import { createDiagramController } from '@subtubes/diagram-core'
import type { ChangeEvent } from '@subtubes/diagram-core'
import { callDiagramTool, createDiagramTools, describeTools, diagramToolSpecs, summarizeDiagram } from './index'

const setup = () => {
  const controller = createDiagramController()
  const events: ChangeEvent[] = []
  controller.onChange((e) => events.push(e))
  return { controller, events, tools: createDiagramTools(controller) }
}

describe('the diagram tools', () => {
  it('validates lane edits and returns ordered membership through the public tool API', () => {
    const { controller, tools, events } = setup()
    expect(callDiagramTool(tools, 'editSwimlanes', { expectedRevision: 0, summary: 'Create workflow', ops: [
      { op: 'createLane', lane: { id: 'customer', title: 'Customer', orientation: 'vertical' } },
      { op: 'createLane', lane: { id: 'reviewer', title: 'Reviewer', body: 'Checks requests' } },
      { op: 'createNode', node: { id: 'request', title: 'Request', body: 'Details', laneId: 'customer' } },
    ] }, { id: 'lane-tool' })).toMatchObject({ ok: true, output: { ok: true, revision: 1, applied: 3 } })
    expect(events[0]).toMatchObject({ id: 'lane-tool', source: 'agent', summary: 'Create workflow' })
    expect(tools.getSwimlanes.run({})).toMatchObject({ revision: 1, lanes: [
      { id: 'customer', title: 'Customer', body: '', orientation: 'vertical', x: 0, y: 0, w: 400, h: 720, nodeIds: ['request'] },
      { id: 'reviewer', title: 'Reviewer', body: 'Checks requests', orientation: 'vertical', x: 400, nodeIds: [] },
    ] })
    expect(tools.editSwimlanes.run({ expectedRevision: 0, summary: 'Stale', ops: [{ op: 'deleteLane', id: 'customer' }] })).toMatchObject({ ok: false, error: 'stale-revision' })
    expect(callDiagramTool(tools, 'editSwimlanes', { expectedRevision: 1, summary: 'Invalid', ops: [{ op: 'arrangeLanes', orientation: 'diagonal' }] })).toMatchObject({ ok: false })
    expect(controller.getSnapshot().groups).toHaveLength(2)
  })

  it('lets an agent read, search and change a diagram, and says what it did', () => {
    const { controller, tools, events } = setup()
    const first = tools.applyChanges.run({
      expectedRevision: 0,
      summary: 'Two nodes',
      ops: [
        { op: 'createNode', node: { id: 'a', title: 'Orders API', body: 'Takes the order and calls payments', color: 'blue' } },
        { op: 'createNode', node: { id: 'b', title: 'Payments', body: 'Charges the card' } },
        { op: 'createEdge', edge: { from: 'a', to: 'b', label: 'charge', color: 'red' } },
      ],
    })
    expect(first).toEqual({ ok: true, revision: 1, applied: 3 })
    expect(events[0]).toMatchObject({ source: 'agent', summary: 'Two nodes' })

    const diagram = tools.getDiagram.run({})
    expect(diagram).toMatchObject({ revision: 1, nodes: [{ id: 'a', color: 'blue' }, { id: 'b' }], edges: [{ from: 'a', to: 'b', label: 'charge', color: 'red' }] })
    expect(diagram.nodes[0]).not.toHaveProperty('body')
    expect(tools.getDiagram.run({ mode: 'full' }).nodes[0]).toHaveProperty('body', 'Takes the order and calls payments')
    expect(tools.getNode.run({ name: 'payments' }).nodes).toMatchObject([{ id: 'b', body: 'Charges the card' }])
    expect(tools.searchNodes.run({ query: 'card' }).matches.map((m) => m.id)).toEqual(['b'])
    expect(controller.getSnapshot().nodes).toHaveLength(2)
  })

  it('records who made the changes, and the id the host gave them', () => {
    const controller = createDiagramController()
    const events: ChangeEvent[] = []
    controller.onChange((e) => events.push(e))
    const tools = createDiagramTools(controller, { source: 'assistant' })
    tools.applyChanges.run({ expectedRevision: 0, summary: 's', ops: [{ op: 'createNode', node: { title: 'A', body: '' } }] }, { id: 'call-7' })
    expect(events[0]).toMatchObject({ source: 'assistant', id: 'call-7' })
  })

  it('refuses a change made against an older revision, or one that is not valid, with the reason, and changes nothing', () => {
    const { controller, tools } = setup()
    tools.applyChanges.run({ expectedRevision: 0, summary: 's', ops: [{ op: 'createNode', node: { title: 'A', body: '' } }] })
    expect(tools.applyChanges.run({ expectedRevision: 0, summary: 's', ops: [{ op: 'createNode', node: { title: 'B', body: '' } }] })).toMatchObject({ ok: false, error: 'stale-revision', currentRevision: 1 })
    expect(tools.applyChanges.run({ expectedRevision: 1, summary: 's', ops: [{ op: 'deleteNode', id: 'ghost' }] })).toMatchObject({ ok: false, error: 'invalid' })
    expect(controller.getSnapshot().nodes).toHaveLength(1)
  })

  it('says so when a node is not there', () => {
    const { tools } = setup()
    expect(() => tools.getNode.run({ id: 'nope' })).toThrow(/No node matches id "nope"/)
  })

  it('takes calls as a model makes them: by name, checked first, never throwing', () => {
    const { tools } = setup()
    expect(callDiagramTool(tools, 'getDiagram', {})).toMatchObject({ ok: true, output: { revision: 0 } })
    expect(callDiagramTool(tools, 'applyChanges', { expectedRevision: 'zero' })).toMatchObject({ ok: false, message: expect.stringContaining('not valid') })
    expect(callDiagramTool(tools, 'getNode', { id: 'x' })).toMatchObject({ ok: false, message: expect.stringContaining('No node matches') })
    expect(callDiagramTool(tools, 'dropTable', {})).toMatchObject({ ok: false, message: expect.stringContaining('There is no tool') })
  })

  it('describes the tools with JSON Schema for a tool-calling API', () => {
    const described = describeTools(createDiagramTools(createDiagramController()))
    expect(described.map((t) => t.name)).toEqual(['getSwimlanes', 'editSwimlanes', 'getDiagram', 'getNode', 'searchNodes', 'applyChanges'])
    const apply = described.find((t) => t.name === 'applyChanges')!
    expect(apply.risk).toBe('write')
    expect(JSON.stringify(apply.parameters)).toContain('createNode')
    expect(JSON.stringify(apply.parameters)).toContain('purple')
    expect(Object.values(diagramToolSpecs).filter((s) => s.risk === 'read').map((s) => s.name)).toEqual(['getDiagram', 'getNode', 'searchNodes', 'getSwimlanes'])
  })

  it('summarizes a saved diagram the same way: it only needs the data', () => {
    const summary = summarizeDiagram({ name: 'Saved', revision: 3, nodes: [{ id: 'n', title: 'N', x: 10, y: 10, w: 100, h: 50, body: 'b' }], edges: [], groups: [{ id: 'g', title: 'G', x: 0, y: 0, w: 200, h: 200 }] })
    expect(summary).toMatchObject({ name: 'Saved', revision: 3, groups: [{ id: 'g', nodeIds: ['n'] }] })
  })
})
