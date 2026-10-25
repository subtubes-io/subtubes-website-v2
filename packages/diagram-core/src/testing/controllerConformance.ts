import { describe, expect, it } from 'vitest'
import type { DiagramController, ChangeEvent } from '../controller'
import type { DiagramOp } from '../ops'

// What every DiagramController must do. A host that supplies its own controller (a remote one, one with extra checks) runs this against it:
//   defineControllerConformance('my controller', () => makeMine())
// `make` returns a fresh, empty controller each time.
export function defineControllerConformance(name: string, make: () => DiagramController) {
  const node = (title: string, extra: Record<string, unknown> = {}): DiagramOp => ({ op: 'createNode', node: { title, body: '', ...extra } })
  const mine = (controller: DiagramController, ops: DiagramOp[], extra: { source?: string; expectedRevision?: number; id?: string } = {}) =>
    controller.apply({ ops, summary: 'test', source: extra.source ?? 'user', ...extra })

  describe(`DiagramController: ${name}`, () => {
    it('starts empty at revision 0, and changes only through apply', () => {
      const c = make()
      expect(c.getSnapshot()).toMatchObject({ nodes: [], edges: [], groups: [], revision: 0 })
      const result = mine(c, [node('A')])
      expect(result).toMatchObject({ ok: true, revision: 1, applied: 1, changed: true })
      expect(c.getSnapshot().nodes.map((n) => n.title)).toEqual(['A'])
      expect(c.getSnapshot().revision).toBe(1)
    })

    it('applies a batch as a whole or not at all, and says why when it is refused', () => {
      const c = make()
      const bad = mine(c, [node('A'), { op: 'deleteNode', id: 'ghost' }])
      expect(bad).toMatchObject({ ok: false, error: 'invalid', currentRevision: 0 })
      expect(c.getSnapshot().nodes).toEqual([])
      expect(c.getSnapshot().revision).toBe(0)
    })

    it('refuses a change made against an older revision, and changes nothing', () => {
      const c = make()
      mine(c, [node('A')])
      const stale = mine(c, [node('B')], { expectedRevision: 0 })
      expect(stale).toMatchObject({ ok: false, error: 'stale-revision', currentRevision: 1 })
      expect(c.getSnapshot().nodes).toHaveLength(1)
      expect(mine(c, [node('B')], { expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 })
    })

    it('does not count a batch that changes nothing', () => {
      const c = make()
      const events: ChangeEvent[] = []
      c.onChange((e) => events.push(e))
      mine(c, [node('A', { id: 'a' })])
      const same = mine(c, [{ op: 'updateNode', id: 'a', patch: { title: 'A' } }])
      expect(same).toMatchObject({ ok: true, changed: false, revision: 1 })
      expect(events).toHaveLength(1)
    })

    it('says what each change was, with the exact inverse, to whoever listens', () => {
      const c = make()
      const events: ChangeEvent[] = []
      c.onChange((e) => events.push(e))
      mine(c, [node('A', { id: 'a' })], { source: 'agent', id: 'call-1' })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ id: 'call-1', source: 'agent', summary: 'test', revision: 1 })
      expect(events[0].patch.nodes.upsert.map((n) => n.id)).toEqual(['a'])
      expect(events[0].inverse.nodes.remove).toEqual(['a'])
    })

    it('undoes exactly what a change did with its inverse, as a change of its own', () => {
      const c = make()
      mine(c, [node('A', { id: 'a', x: 10, y: 20 }), node('B', { id: 'b', x: 400, y: 20 })])
      const before = structuredClone(c.getSnapshot())
      const events: ChangeEvent[] = []
      c.onChange((e) => events.push(e))
      const change = mine(c, [{ op: 'createEdge', edge: { from: 'a', to: 'b', label: 'x' } }, { op: 'deleteNode', id: 'b' }, { op: 'updateNode', id: 'a', patch: { color: 'red' } }])
      if (!change.ok) throw new Error(change.message)
      expect(c.getSnapshot().nodes.map((n) => n.id)).toEqual(['a'])
      // Something unrelated happens afterwards: undoing the first change must not undo it.
      mine(c, [node('C', { id: 'c' })])
      const undo = c.applyPatch(change.inverse, { summary: 'Undo', source: 'undo' })
      expect(undo).toMatchObject({ ok: true, changed: true })
      const after = c.getSnapshot()
      expect(after.nodes.find((n) => n.id === 'a')).toEqual(before.nodes.find((n) => n.id === 'a'))
      expect(after.nodes.find((n) => n.id === 'b')).toEqual(before.nodes.find((n) => n.id === 'b'))
      expect(after.nodes.find((n) => n.id === 'c')).toBeDefined()
      expect(after.edges).toEqual([])
      expect(events.at(-1)).toMatchObject({ source: 'undo', summary: 'Undo' })
      expect(after.revision).toBe(before.revision + 3)
    })

    it('gives a plain-data snapshot that stays the same object until something changes', () => {
      const c = make()
      mine(c, [node('A')])
      const one = c.getSnapshot()
      expect(c.getSnapshot()).toBe(one)
      mine(c, [node('B')])
      expect(c.getSnapshot()).not.toBe(one)
      expect(one.nodes).toHaveLength(1)
    })

    it('tells subscribers once for each change, and stops when they unsubscribe', () => {
      const c = make()
      let calls = 0
      const off = c.subscribe(() => calls++)
      mine(c, [node('A'), node('B'), { op: 'createEdge', edge: { from: 'A', to: 'B', label: '' } }])
      expect(calls).toBe(1)
      off()
      mine(c, [node('C')])
      expect(calls).toBe(1)
    })

    it('loads a whole diagram without making it a change, and exports it as a file', () => {
      const c = make()
      const loaded: string[] = []
      const changes: ChangeEvent[] = []
      c.onLoad(() => loaded.push('load'))
      c.onChange((e) => changes.push(e))
      c.load({ name: 'Mine', description: 'about it', nodes: [{ id: 'n', title: 'N', x: 0, y: 0, w: 160, h: 80, body: 'b', color: 'blue' }], edges: [], groups: [] }, 7)
      expect(loaded).toEqual(['load'])
      expect(changes).toEqual([])
      expect(c.getSnapshot()).toMatchObject({ name: 'Mine', description: 'about it', revision: 7 })
      expect(c.export()).toMatchObject({ name: 'Mine', description: 'about it', nodes: [{ id: 'n', color: 'blue' }], edges: [], groups: [] })
      expect(c.export({ name: 'Other' }).name).toBe('Other')
    })

    it('keeps two controllers apart', () => {
      const a = make()
      const b = make()
      mine(a, [node('Only in a')])
      expect(b.getSnapshot().nodes).toEqual([])
    })
  })
}
