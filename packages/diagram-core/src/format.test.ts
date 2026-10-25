import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NotADocumentError, UnsupportedVersionError } from './versioning'
import { diagramFormat, diagramV1Schema, diagramV2Schema, diagramV3Schema, parseDiagramJson, readDiagram, serializeDiagram } from './format'

// fixtures/diagram.v1.json and diagram.v2.json are golden files: each is its version exactly as released and must
// never be edited. Every version stays here and must keep reading.
const v1Text = readFileSync(new URL('./fixtures/diagram.v1.json', import.meta.url), 'utf8')
const v2Text = readFileSync(new URL('./fixtures/diagram.v2.json', import.meta.url), 'utf8')

describe('diagram format', () => {
  it('reads the v2 golden fixture as it is', () => {
    const result = readDiagram(JSON.parse(v2Text))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.from).toBe(2)
    expect(result.upgraded).toBe(true)
    expect(result.value.nodes.some((n) => n.color === '#0ea5e9' && n.layer === undefined)).toBe(true)
    expect(result.value.edges[0].color).toBe('red')
  })

  it('preserves v2 contents when writing the current version', () => {
    expect(JSON.parse(serializeDiagram(parseDiagramJson(v2Text)))).toEqual({ ...JSON.parse(v2Text), schemaVersion: 3 })
  })

  it('reads the v1 golden fixture and upgrades it, giving each node and group the colour of its layer', () => {
    const result = readDiagram(JSON.parse(v1Text))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.from).toBe(1)
    expect(result.upgraded).toBe(true)
    const v1 = JSON.parse(v1Text) as { nodes: { id: string; layer: string }[]; groups: { id: string; layer: string }[] }
    const wanted = { ui: 'blue', runtime: 'purple', tools: 'orange', domain: 'green' } as Record<string, string>
    for (const n of v1.nodes) expect(result.value.nodes.find((m) => m.id === n.id)?.color).toBe(wanted[n.layer])
    for (const g of v1.groups) expect(result.value.groups.find((m) => m.id === g.id)?.color).toBe(wanted[g.layer])
    expect(result.value.edges.every((e) => e.color === undefined)).toBe(true)
  })

  it('is idempotent on its own output', () => {
    const once = parseDiagramJson(v1Text)
    expect(parseDiagramJson(serializeDiagram(once))).toEqual(once)
  })

  it('refuses a newer file and a non-diagram', () => {
    const newer = readDiagram({ ...JSON.parse(v2Text), schemaVersion: 4 })
    expect(!newer.ok && newer.error).toBeInstanceOf(UnsupportedVersionError)
    const junk = readDiagram({ hello: 'world' })
    expect(!junk.ok && junk.error).toBeInstanceOf(NotADocumentError)
  })

  it('knows its supported range', () => {
    expect(diagramFormat.minSupported).toBe(1)
    expect(diagramFormat.current).toBe(3)
  })

  it('does not need a layer, and refuses a colour that is neither a preset nor a #rrggbb', () => {
    const base = JSON.parse(v2Text) as { nodes: Record<string, unknown>[]; groups: Record<string, unknown>[]; edges: Record<string, unknown>[] }
    const withNode = (patch: Record<string, unknown>) => ({ ...base, nodes: [{ id: 'x', title: 'X', x: 0, y: 0, w: 160, h: 80, body: '', ...patch }], edges: [], groups: [] })
    expect(readDiagram(withNode({})).ok).toBe(true)
    expect(readDiagram(withNode({ color: 'teal' })).ok).toBe(true)
    expect(readDiagram(withNode({ color: '#A1b2C3' })).ok).toBe(true)
    for (const bad of ['chartreuse', '#fff', '#12345g', 'red; background:url(x)', 'rgb(1,2,3)', '', 'Red']) expect(readDiagram(withNode({ color: bad })).ok).toBe(false)
    expect(readDiagram({ ...base, edges: [{ ...base.edges[0], color: 'nope' }] }).ok).toBe(false)
    expect(readDiagram({ ...base, groups: [{ ...base.groups[0], color: 'nope' }] }).ok).toBe(false)
  })

  // Fail if a released schema is edited. To change the format, add a new version instead.
  it('has not changed the released v1 schema', async () => {
    const json = JSON.stringify(z.toJSONSchema(diagramV1Schema), null, 2) + '\n'
    await expect(json).toMatchFileSnapshot('./fixtures/diagram.v1.schema.json')
  })

  it('has not changed the released v2 schema', async () => {
    const json = JSON.stringify(z.toJSONSchema(diagramV2Schema), null, 2) + '\n'
    await expect(json).toMatchFileSnapshot('./fixtures/diagram.v2.schema.json')
  })
  it('records the v3 swimlane schema', async () => {
    await expect(JSON.stringify(z.toJSONSchema(diagramV3Schema), null, 2) + '\n').toMatchFileSnapshot('./fixtures/diagram.v3.schema.json')
  })
})
