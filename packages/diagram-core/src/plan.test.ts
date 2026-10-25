import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDiagram } from './format'
import type { DiagramOp } from './ops'
import { LIMITS, applyPatch, diffSnapshots, isEmptyPatch, planChanges } from './plan'
import type { Snapshot } from './plan'

// The sample architecture diagram (a v1 file, upgraded on read) that the plan tests are written against.
const sampleDiagram = parseDiagram(JSON.parse(readFileSync(new URL('./fixtures/diagram.v1.json', import.meta.url), 'utf8')))

const base = (): Snapshot => structuredClone({ nodes: sampleDiagram.nodes, edges: sampleDiagram.edges, groups: sampleDiagram.groups })
const plan = (ops: DiagramOp[], snapshot = base()) => planChanges(snapshot, ops)

const okPlan = (ops: DiagramOp[], snapshot = base()) => {
  const result = plan(ops, snapshot)
  if (!result.ok) throw new Error(result.message)
  return result
}

describe('createNode', () => {
  it('adds a node under the one added last, with a generated id', () => {
    const { next } = okPlan([{ op: 'createNode', node: { title: 'Undo Stack', body: 'Keeps inverse patches.' } }])
    const created = next.nodes.find((n) => n.title === 'Undo Stack')
    expect(created?.id).toBe('undo-stack')
    const last = base().nodes[base().nodes.length - 1]
    expect(created?.x).toBe(last.x)
    // Below every node in that column.
    const lowest = Math.max(...base().nodes.filter((n) => n.x === last.x).map((n) => n.y + n.h))
    expect(created?.y).toBe(lowest + 30)
    expect(created).not.toHaveProperty('color')
  })

  it('grows the box around the column when the new node would not fit', () => {
    const { next } = okPlan([{ op: 'createNode', node: { title: 'Undo Stack', body: '' } }])
    const last = base().nodes[base().nodes.length - 1]
    const home = (groups: Snapshot['groups']) => groups.find((g) => last.x >= g.x && last.x < g.x + g.w && last.y >= g.y && last.y < g.y + g.h)!
    const created = next.nodes.find((n) => n.id === 'undo-stack')!
    expect(created.y + created.h).toBeLessThanOrEqual(home(next.groups).y + home(next.groups).h)
    expect(home(next.groups).h).toBeGreaterThanOrEqual(home(base().groups).h)
  })

  it('gives a new node the colour it was asked for, and none otherwise', () => {
    const { next } = okPlan([{ op: 'createNode', node: { title: 'Red one', body: '', color: 'red' } }, { op: 'createNode', node: { title: 'Mine', body: '', color: '#12ab9f' } }])
    expect(next.nodes.find((n) => n.id === 'red-one')?.color).toBe('red')
    expect(next.nodes.find((n) => n.id === 'mine')?.color).toBe('#12ab9f')
  })

  it('keeps generated ids unique', () => {
    const { next } = okPlan([
      { op: 'createNode', node: { title: 'Cache', body: '' } },
      { op: 'createNode', node: { title: 'Cache', body: '' } },
    ])
    expect(next.nodes.filter((n) => n.title === 'Cache').map((n) => n.id)).toEqual(['cache', 'cache-2'])
  })

  it('lets later operations in the batch refer to a node created earlier', () => {
    const { next } = okPlan([
      { op: 'createNode', node: { id: 'undo', title: 'Undo Stack', body: '' } },
      { op: 'createEdge', edge: { from: 'rt-approval', to: 'undo', label: 'applied change' } },
    ])
    expect(next.edges.some((e) => e.from === 'rt-approval' && e.to === 'undo')).toBe(true)
  })

  it('refuses a duplicate or invalid id, and oversized text', () => {
    expect(plan([{ op: 'createNode', node: { id: 'rt-loop', title: 'X', body: '' } }])).toMatchObject({ ok: false })
    expect(plan([{ op: 'createNode', node: { id: '../x', title: 'X', body: '' } }])).toMatchObject({ ok: false })
    expect(plan([{ op: 'createNode', node: { title: 'X', body: 'x'.repeat(LIMITS.body + 1) } }])).toMatchObject({ ok: false })
  })

  it('stacks nodes in a diagram with no groups', () => {
    const empty: Snapshot = { nodes: [], edges: [], groups: [] }
    const { next } = okPlan(
      [
        { op: 'createNode', node: { title: 'A', body: '' } },
        { op: 'createNode', node: { title: 'B', body: '' } },
        { op: 'createNode', node: { title: 'C', body: '' } },
      ],
      empty,
    )
    const [a, b, c] = next.nodes
    expect(b.x).toBe(a.x)
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h)
    expect(c.y).toBeGreaterThanOrEqual(b.y + b.h)
    expect(next.groups).toEqual([])
  })
})

describe('naming nodes by title', () => {
  const nodes = (): Snapshot => ({ nodes: [], edges: [], groups: [] })

  it('lets an edge follow the nodes created earlier in the same batch', () => {
    const { next } = okPlan(
      [
        { op: 'createNode', node: { title: 'AI Harness', body: '' } },
        { op: 'createNode', node: { title: 'Data Processing', body: '' } },
        { op: 'createEdge', edge: { from: 'AI Harness', to: 'Data Processing', label: 'feeds' } },
        { op: 'createEdge', edge: { from: 'data processing', to: 'ai-harness', label: 'back' } },
      ],
      nodes(),
    )
    expect(next.edges.map((e) => [e.from, e.to])).toEqual([['ai-harness', 'data-processing'], ['data-processing', 'ai-harness']])
  })

  it('prefers an id to a title, and refuses a title that fits two nodes', () => {
    const start: Snapshot = {
      nodes: [
        { id: 'a', title: 'B', layer: 'ui', x: 0, y: 0, w: 160, h: 80, body: '' },
        { id: 'b', title: 'Same', layer: 'ui', x: 0, y: 100, w: 160, h: 80, body: '' },
        { id: 'c', title: 'Same', layer: 'ui', x: 0, y: 200, w: 160, h: 80, body: '' },
      ],
      edges: [],
      groups: [],
    }
    expect(okPlan([{ op: 'createEdge', edge: { from: 'b', to: 'a', label: '' } }], start).next.edges[0]).toMatchObject({ from: 'b', to: 'a' })
    expect(plan([{ op: 'createEdge', edge: { from: 'Same', to: 'a', label: '' } }], start)).toMatchObject({ ok: false, message: expect.stringContaining('More than one node is titled "Same"') })
    expect(plan([{ op: 'createEdge', edge: { from: 'nope', to: 'a', label: '' } }], start)).toMatchObject({ ok: false, message: expect.stringContaining('There is no node "nope"') })
  })

  it('also names the nodes of a new group by title', () => {
    const { next } = okPlan(
      [
        { op: 'createNode', node: { title: 'One', body: '' } },
        { op: 'createNode', node: { title: 'Two', body: '' } },
        { op: 'createGroup', group: { title: 'Pair', nodeIds: ['One', 'Two'] } },
      ],
      nodes(),
    )
    expect(next.groups).toHaveLength(1)
  })
})

describe('groups', () => {
  const two = (): Snapshot => okPlan(
    [
      { op: 'createNode', node: { id: 'a', title: 'A', body: '' } },
      { op: 'createNode', node: { id: 'b', title: 'B', body: '' } },
    ],
    { nodes: [], edges: [], groups: [] },
  ).next

  it('draws a box around the given nodes, and renames and removes it', () => {
    const { next } = okPlan([{ op: 'createGroup', group: { title: 'Payments', nodeIds: ['a', 'b'] } }], two())
    const [g] = next.groups
    expect(g).toMatchObject({ id: 'payments', title: 'Payments' })
    for (const n of next.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(g.x)
      expect(n.x + n.w).toBeLessThanOrEqual(g.x + g.w)
      expect(n.y).toBeGreaterThanOrEqual(g.y)
      expect(n.y + n.h).toBeLessThanOrEqual(g.y + g.h)
    }
    const renamed = okPlan([{ op: 'updateGroup', id: 'payments', patch: { title: 'Billing' } }], next).next
    expect(renamed.groups[0].title).toBe('Billing')
    const removed = okPlan([{ op: 'deleteGroup', id: 'payments' }], renamed).next
    expect(removed.groups).toEqual([])
    expect(removed.nodes).toHaveLength(2)
  })

  it('moves and resizes a group, and refuses one that is too small', () => {
    const { next } = okPlan([{ op: 'createGroup', group: { id: 'g', title: 'G', nodeIds: ['a'] } }], two())
    const moved = okPlan([{ op: 'updateGroup', id: 'g', patch: { x: 5, y: 6, w: 400 } }], next).next.groups[0]
    expect(moved).toMatchObject({ x: 5, y: 6, w: 400, title: 'G' })
    expect(plan([{ op: 'updateGroup', id: 'g', patch: { w: 50 } }], next)).toMatchObject({ ok: false, message: expect.stringContaining('narrower than 120') })
    expect(plan([{ op: 'updateGroup', id: 'g', patch: {} }], next)).toMatchObject({ ok: false, message: expect.stringContaining('changes nothing') })
  })

  it('moving a group moves what is inside it, but not what is outside; resizing moves nothing', () => {
    const start: Snapshot = {
      nodes: [
        { id: 'in', title: 'In', layer: 'ui', x: 20, y: 40, w: 160, h: 80, body: '' },
        { id: 'out', title: 'Out', layer: 'ui', x: 600, y: 40, w: 160, h: 80, body: '' },
      ],
      edges: [],
      groups: [
        { id: 'outer', title: 'Outer', layer: 'ui', x: 0, y: 0, w: 400, h: 300 },
        { id: 'inner', title: 'Inner', layer: 'ui', x: 10, y: 150, w: 200, h: 100 },
        { id: 'elsewhere', title: 'Elsewhere', layer: 'ui', x: 500, y: 0, w: 300, h: 300 },
      ],
    }
    const moved = okPlan([{ op: 'updateGroup', id: 'outer', patch: { x: 50, y: 10 } }], start).next
    const at = (id: string) => [...moved.nodes, ...moved.groups].find((e) => e.id === id)!
    expect(at('outer')).toMatchObject({ x: 50, y: 10, w: 400, h: 300 })
    expect(at('in')).toMatchObject({ x: 70, y: 50 })
    expect(at('inner')).toMatchObject({ x: 60, y: 160 })
    expect(at('out')).toMatchObject({ x: 600, y: 40 })
    expect(at('elsewhere')).toMatchObject({ x: 500, y: 0 })

    const resized = okPlan([{ op: 'updateGroup', id: 'outer', patch: { x: 50, w: 500 } }], start).next
    expect(resized.nodes.find((n) => n.id === 'in')).toMatchObject({ x: 20, y: 40 })
  })

  it('makes an empty group at a position, with a default size or the one given', () => {
    const empty: Snapshot = { nodes: [], edges: [], groups: [] }
    const { next } = okPlan([{ op: 'createGroup', group: { title: 'Fresh', nodeIds: [], x: 10, y: 20 } }], empty)
    expect(next.groups[0]).toMatchObject({ id: 'fresh', title: 'Fresh', x: 10, y: 20, w: 360, h: 240 })
    const sized = okPlan([{ op: 'createGroup', group: { title: 'Sized', nodeIds: [], x: 0, y: 0, w: 500, h: 300, color: 'teal' } }], empty).next.groups[0]
    expect(sized).toMatchObject({ w: 500, h: 300, color: 'teal' })
  })

  it('refuses a group with neither nodes nor a position, or one that is too small', () => {
    const empty: Snapshot = { nodes: [], edges: [], groups: [] }
    expect(plan([{ op: 'createGroup', group: { title: 'X', nodeIds: [] } }], empty)).toMatchObject({ ok: false, message: expect.stringContaining('needs nodes') })
    expect(plan([{ op: 'createGroup', group: { title: 'X', nodeIds: [], x: 0, y: 0, w: 50 } }], empty)).toMatchObject({ ok: false, message: expect.stringContaining('narrower than 120') })
  })

  it('refuses unknown nodes and groups', () => {
    expect(plan([{ op: 'createGroup', group: { title: 'X', nodeIds: ['nope'] } }], two())).toMatchObject({ ok: false, message: expect.stringContaining('no node "nope"') })
    expect(plan([{ op: 'deleteGroup', id: 'nope' }], two())).toMatchObject({ ok: false, message: expect.stringContaining('no group "nope"') })
  })
})

describe('updateNode geometry', () => {
  it('moves and resizes a node and leaves the rest of it alone', () => {
    const before = base().nodes.find((n) => n.id === 'rt-loop')!
    const node = okPlan([{ op: 'updateNode', id: 'rt-loop', patch: { x: 7, h: 300 } }]).next.nodes.find((n) => n.id === 'rt-loop')!
    expect(node).toMatchObject({ x: 7, y: before.y, w: before.w, h: 300, title: before.title })
  })

  it('refuses a node smaller than the minimum, naming the rule', () => {
    expect(plan([{ op: 'updateNode', id: 'rt-loop', patch: { w: 100 } }])).toMatchObject({ ok: false, message: expect.stringContaining('narrower than 160') })
    expect(plan([{ op: 'updateNode', id: 'rt-loop', patch: { h: 20 } }])).toMatchObject({ ok: false, message: expect.stringContaining('shorter than 80') })
  })
})

describe('updateNode', () => {
  it('changes only the fields given', () => {
    const { next } = okPlan([{ op: 'updateNode', id: 'rt-loop', patch: { title: 'Agent Loop v2' } }])
    const before = base().nodes.find((n) => n.id === 'rt-loop')!
    expect(next.nodes.find((n) => n.id === 'rt-loop')).toEqual({ ...before, title: 'Agent Loop v2' })
  })

  it('sets, changes and removes the colour of a node, a group and an edge, and only that', () => {
    const edgeId = base().edges[0].id
    const groupId = base().groups[0].id
    const set = okPlan([
      { op: 'updateNode', id: 'rt-loop', patch: { color: 'pink' } },
      { op: 'updateGroup', id: groupId, patch: { color: '#0a0b0c' } },
      { op: 'updateEdge', id: edgeId, patch: { color: 'gray' } },
    ]).next
    const node = set.nodes.find((n) => n.id === 'rt-loop')!
    expect(node.color).toBe('pink')
    expect(node).toMatchObject({ x: base().nodes.find((n) => n.id === 'rt-loop')!.x, title: base().nodes.find((n) => n.id === 'rt-loop')!.title })
    expect(set.groups.find((g) => g.id === groupId)?.color).toBe('#0a0b0c')
    expect(set.edges.find((e) => e.id === edgeId)?.color).toBe('gray')

    const cleared = okPlan([{ op: 'updateNode', id: 'rt-loop', patch: { color: null } }], set).next
    expect(cleared.nodes.find((n) => n.id === 'rt-loop')).not.toHaveProperty('color')
    expect(plan([{ op: 'updateNode', id: 'rt-loop', patch: { color: null } }], cleared)).toMatchObject({ ok: true })
  })

  it('undoes a colour change exactly', () => {
    const start = base()
    const result = okPlan([{ op: 'updateNode', id: 'rt-loop', patch: { color: 'red' } }], start)
    expect(applyPatch(result.next, result.inverse).nodes.find((n) => n.id === 'rt-loop')).toEqual(start.nodes.find((n) => n.id === 'rt-loop'))
  })

  it('refuses an unknown node and an empty update', () => {
    expect(plan([{ op: 'updateNode', id: 'ghost', patch: { title: 'x' } }])).toMatchObject({ ok: false })
    expect(plan([{ op: 'updateNode', id: 'rt-loop', patch: {} }])).toMatchObject({ ok: false })
  })
})

describe('deleteNode', () => {
  it('takes the node and its edges, and nothing else', () => {
    const touching = base().edges.filter((e) => e.from === 'd-bus' || e.to === 'd-bus')
    expect(touching.length).toBeGreaterThan(0)
    const { next } = okPlan([{ op: 'deleteNode', id: 'd-bus' }])
    expect(next.nodes.some((n) => n.id === 'd-bus')).toBe(false)
    expect(next.edges.some((e) => e.from === 'd-bus' || e.to === 'd-bus')).toBe(false)
    expect(next.edges).toHaveLength(base().edges.length - touching.length)
  })
})

describe('edges', () => {
  it('creates, updates and deletes', () => {
    const created = okPlan([{ op: 'createEdge', edge: { id: 'new-edge', from: 'ui-chat', to: 'd-bus', label: 'events', dashed: true } }])
    expect(created.next.edges.find((e) => e.id === 'new-edge')).toEqual({ id: 'new-edge', from: 'ui-chat', to: 'd-bus', label: 'events', dashed: true })

    const updated = okPlan([{ op: 'updateEdge', id: 'e1', patch: { label: 'renamed' } }])
    expect(updated.next.edges.find((e) => e.id === 'e1')?.label).toBe('renamed')

    const deleted = okPlan([{ op: 'deleteEdge', id: 'e1' }])
    expect(deleted.next.edges.some((e) => e.id === 'e1')).toBe(false)
  })

  it('refuses dangling, self and duplicate edges', () => {
    expect(plan([{ op: 'createEdge', edge: { from: 'ui-chat', to: 'ghost', label: 'x' } }])).toMatchObject({ ok: false })
    expect(plan([{ op: 'createEdge', edge: { from: 'ui-chat', to: 'ui-chat', label: 'x' } }])).toMatchObject({ ok: false })
    const e1 = base().edges[0]
    expect(plan([{ op: 'createEdge', edge: { from: e1.from, to: e1.to, label: e1.label } }])).toMatchObject({ ok: false })
  })
})

describe('a batch', () => {
  it('is all or nothing, and names the operation that failed', () => {
    const result = plan([
      { op: 'updateNode', id: 'rt-loop', patch: { title: 'Fine' } },
      { op: 'deleteNode', id: 'ghost' },
    ])
    expect(result).toMatchObject({ ok: false, opIndex: 1, message: expect.stringContaining('Change 2 (deleteNode)') })
  })

  it('does not modify the snapshot it was given', () => {
    const snapshot = base()
    const frozen = JSON.stringify(snapshot)
    okPlan([{ op: 'deleteNode', id: 'd-bus' }, { op: 'createNode', node: { title: 'N', body: '' } }], snapshot)
    expect(JSON.stringify(snapshot)).toBe(frozen)
  })
})

describe('patches', () => {
  it('the inverse puts everything back, including edges and the column size', () => {
    const before = base()
    const result = okPlan([
      { op: 'deleteNode', id: 'd-bus' },
      { op: 'createNode', node: { id: 'undo', title: 'Undo Stack', body: '' } },
      { op: 'updateEdge', id: 'e1', patch: { label: 'changed' } },
    ])
    const restored = applyPatch(result.next, result.inverse)
    const sort = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
    expect(sort(restored.nodes)).toEqual(sort(before.nodes))
    expect(sort(restored.edges)).toEqual(sort(before.edges))
    expect(sort(restored.groups)).toEqual(sort(before.groups))
  })

  it('undoing leaves unrelated later edits alone', () => {
    const before = base()
    const result = okPlan([{ op: 'updateNode', id: 'rt-loop', patch: { title: 'Changed' } }])
    // The user then drags a different node.
    const dragged: Snapshot = { ...result.next, nodes: result.next.nodes.map((n) => (n.id === 'ui-chat' ? { ...n, x: 999 } : n)) }
    const undone = applyPatch(dragged, result.inverse)
    expect(undone.nodes.find((n) => n.id === 'rt-loop')?.title).toBe(before.nodes.find((n) => n.id === 'rt-loop')?.title)
    expect(undone.nodes.find((n) => n.id === 'ui-chat')?.x).toBe(999)
  })

  it('an empty change has an empty patch', () => {
    expect(isEmptyPatch(diffSnapshots(base(), base()))).toBe(true)
  })
})
