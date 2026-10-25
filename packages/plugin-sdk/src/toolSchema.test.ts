import { describe, expect, it } from 'vitest'
import { isPluginToolName, schemaToZod, toolName, toolSchemaProblems } from './toolSchema'
import { readManifest } from './manifest'

const card = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80, description: 'What the card says.' },
    column: { enum: ['todo', 'doing', 'done'], type: 'string' },
    points: { type: 'integer', minimum: 0, maximum: 20 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    done: { type: 'boolean' },
  },
  required: ['title'],
  additionalProperties: false,
}

describe('a tool input schema', () => {
  it('accepts the part of JSON Schema that tool inputs are written in', () => {
    expect(toolSchemaProblems(card)).toEqual([])
    expect(toolSchemaProblems({ type: 'object' })).toEqual([])
    expect(toolSchemaProblems({ type: 'object', properties: { nested: { type: 'object', properties: { x: { type: 'number' } } } } })).toEqual([])
  })

  it('refuses what depends on how a library reads it, naming where', () => {
    for (const [what, schema] of [
      ['$ref', { type: 'object', properties: { a: { $ref: '#/x' } } }],
      ['oneOf', { type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } } }],
      ['pattern', { type: 'object', properties: { a: { type: 'string', pattern: '(a+)+$' } } }],
      ['a top level that is not an object', { type: 'string' }],
      ['an unknown type', { type: 'object', properties: { a: { type: 'null' } } }],
      ['required that names nothing', { type: 'object', properties: {}, required: ['x'] }],
      ['an array without items', { type: 'object', properties: { a: { type: 'array' } } }],
      ['an empty enum', { type: 'object', properties: { a: { enum: [] } } }],
    ] as const) {
      expect(toolSchemaProblems(schema).length, what).toBeGreaterThan(0)
    }
    expect(toolSchemaProblems({ type: 'object', properties: { a: { $ref: 'x' } } })[0]).toContain('inputSchema.properties.a.$ref')
    let deep: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 6; i++) deep = { type: 'object', properties: { x: deep } }
    expect(toolSchemaProblems(deep).join(' ')).toContain('too deep')
  })

  it('checks an input the way the schema says', () => {
    const zod = schemaToZod(card)
    expect(zod.safeParse({ title: 'Write docs' }).success).toBe(true)
    expect(zod.safeParse({ title: 'x', column: 'doing', points: 3, tags: ['a'], done: false }).success).toBe(true)
    for (const bad of [{}, { title: '' }, { title: 'x', column: 'later' }, { title: 'x', points: 2.5 }, { title: 'x', points: 99 }, { title: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, { title: 'x', extra: 1 }, 'text']) {
      expect(zod.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('is checked when a manifest is read', () => {
    const manifest = {
      id: 'acme.kanban', name: 'Kanban', version: '1.0.0', apiVersion: 1, ui: { entry: 'ui.js' },
      permissions: [{ permission: 'chat.contribute', reason: 'x' }],
      contributes: { chatTools: [{ id: 'add', description: 'Add a card', inputSchema: { type: 'object', properties: { a: { $ref: 'x' } } }, risk: 'write', runsIn: 'ui' }] },
    }
    const read = readManifest(JSON.stringify(manifest))
    expect(read.ok).toBe(false)
    expect(!read.ok && read.problems.join(' ')).toContain('$ref')
  })
})

describe('a tool name', () => {
  it('names the plugin and the tool, in the characters model providers allow', () => {
    expect(toolName('acme.kanban', 'addCard')).toBe('acme_kanban__addCard')
    expect(toolName('ample.computer', 'check')).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(isPluginToolName('acme_kanban__addCard')).toBe(true)
    expect(isPluginToolName('applyChanges')).toBe(false)
  })

  it('cannot be an app tool, whatever the plugin calls its tool', () => {
    for (const app of ['applyChanges', 'getDiagram', 'readFile', 'showCode']) expect(toolName('x.y', app)).not.toBe(app)
  })

  it('is refused in a manifest when it would be too long', () => {
    const id = 'acme.' + 'a'.repeat(50)
    const manifest = { id, name: 'X', version: '1.0.0', apiVersion: 1, ui: { entry: 'ui.js' }, permissions: [{ permission: 'chat.contribute', reason: 'x' }], contributes: { chatTools: [{ id: 'b'.repeat(40), description: 'x', inputSchema: { type: 'object' }, risk: 'read', runsIn: 'ui' }] } }
    expect(readManifest(JSON.stringify(manifest))).toMatchObject({ ok: false, problems: [expect.stringContaining('longer than 64')] })
  })
})
