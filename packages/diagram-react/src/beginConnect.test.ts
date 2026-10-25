import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDiagramController, parseDiagram } from '@subtubes/diagram-core'
import type { ChangeEvent } from '@subtubes/diagram-core'
import { connectNodes } from './beginConnect'
import { createDiagramInstance } from './instance'

const sample = parseDiagram(JSON.parse(readFileSync(new URL('../../diagram-core/src/fixtures/diagram.v1.json', import.meta.url), 'utf8')))

let controller: ReturnType<typeof createDiagramController>
let instance: ReturnType<typeof createDiagramInstance>
let events: ChangeEvent[]

beforeEach(() => {
  controller = createDiagramController(sample)
  instance = createDiagramInstance(controller)
  events = []
  controller.onChange((e) => events.push(e))
})

describe('connectNodes', () => {
  it('adds an unlabelled edge as one undoable change and selects it', () => {
    const before = controller.getSnapshot().edges.length
    connectNodes(instance, 'ui-chat', 'rt-loop')
    const edges = controller.getSnapshot().edges
    expect(edges).toHaveLength(before + 1)
    const created = edges[edges.length - 1]
    expect(created).toMatchObject({ from: 'ui-chat', to: 'rt-loop', label: '' })
    expect(instance.ui.selection.getState().selection).toEqual({ kind: 'edge', id: created.id })
    expect(events[0]).toMatchObject({ source: 'user', summary: expect.stringContaining('Connect') })
    controller.applyPatch(events[0].inverse, { summary: 'Undo', source: 'undo' })
    expect(controller.getSnapshot().edges).toHaveLength(before)
    // What was selected is gone, so the canvas lets go of it.
    expect(instance.ui.selection.getState().selection).toBeNull()
  })

  it('selects the edge that is already there instead of adding a copy', () => {
    connectNodes(instance, 'ui-chat', 'rt-loop')
    const count = controller.getSnapshot().edges.length
    connectNodes(instance, 'ui-chat', 'rt-loop')
    expect(controller.getSnapshot().edges).toHaveLength(count)
    expect(events).toHaveLength(1)
  })

  it('does nothing for a node that is not there', () => {
    const count = controller.getSnapshot().edges.length
    connectNodes(instance, 'ui-chat', 'ghost')
    expect(controller.getSnapshot().edges).toHaveLength(count)
    expect(instance.ui.selection.getState().selection).toBeNull()
  })
})

describe('two diagrams on one page', () => {
  it('keep their own changes, selection and view', () => {
    const other = createDiagramInstance(createDiagramController())
    connectNodes(instance, 'ui-chat', 'rt-loop')
    expect(other.controller.getSnapshot().edges).toEqual([])
    expect(other.ui.selection.getState().selection).toBeNull()
    instance.ui.viewport.getState().panBy(10, 20)
    expect(other.ui.viewport.getState().x).not.toBe(instance.ui.viewport.getState().x)
    expect(other.uid).not.toBe(instance.uid)
  })

  it('forget the selection and the edit when another diagram is loaded', () => {
    instance.ui.selection.getState().select({ kind: 'node', id: 'rt-loop' })
    instance.ui.edit.getState().editNode('rt-loop', 'title')
    controller.load(sample, 0)
    expect(instance.ui.selection.getState().selection).toBeNull()
    expect(instance.ui.edit.getState().node).toBeNull()
  })
})
