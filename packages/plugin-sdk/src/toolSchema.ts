import { z } from 'zod'

// What a plugin's chat tool takes, written as JSON Schema in the manifest, but only a small part of it: enough for the inputs people write
// for tools (an object of strings, numbers, booleans, lists and choices), and nothing whose meaning depends on how a library reads it.
// The manifest is refused if it uses anything else, so a plugin cannot offer a tool whose input the app would check differently from the
// model's own reading of it. `schemaToZod` is what the host and the server check an input with.

type Json = Record<string, unknown>

const KEYWORDS = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'additionalProperties', 'default', 'title'])
const TYPES = new Set(['object', 'string', 'number', 'integer', 'boolean', 'array'])
const MAX_DEPTH = 4
const MAX_PROPERTIES = 30

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

// Every reason a schema is not in the part this accepts; empty when it is.
export function toolSchemaProblems(schema: unknown, path = 'inputSchema', depth = 0): string[] {
  if (!isObject(schema)) return [`${path}: must be an object.`]
  const problems: string[] = []
  if (depth > MAX_DEPTH) return [`${path}: nested too deep (at most ${MAX_DEPTH} levels).`]
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) problems.push(`${path}.${key}: "${key}" is not supported in a tool's input schema.`)
  if (typeof schema.type !== 'string' || !TYPES.has(schema.type)) {
    problems.push(`${path}.type: use one of ${[...TYPES].join(', ')}.`)
    return problems
  }
  if (depth === 0 && schema.type !== 'object') problems.push(`${path}.type: the input of a tool is an object.`)
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) problems.push(`${path}.enum: a list of strings, numbers or booleans.`)
  }
  if (schema.type === 'object') {
    const properties = schema.properties === undefined ? {} : schema.properties
    if (!isObject(properties)) problems.push(`${path}.properties: must be an object.`)
    else {
      const names = Object.keys(properties)
      if (names.length > MAX_PROPERTIES) problems.push(`${path}.properties: at most ${MAX_PROPERTIES} properties.`)
      for (const name of names) problems.push(...toolSchemaProblems(properties[name], `${path}.properties.${name}`, depth + 1))
      if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((r) => typeof r === 'string' && names.includes(r)))) problems.push(`${path}.required: names of properties of this object.`)
    }
  }
  if (schema.type === 'array') {
    if (schema.items === undefined) problems.push(`${path}.items: an array needs the schema of its items.`)
    else problems.push(...toolSchemaProblems(schema.items, `${path}.items`, depth + 1))
  }
  return problems
}

function build(schema: Json): z.ZodType {
  let out: z.ZodType
  const description = typeof schema.description === 'string' ? schema.description : undefined
  if (Array.isArray(schema.enum)) {
    const values = schema.enum as (string | number | boolean)[]
    out = z.union(values.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<string>, z.ZodLiteral<string>])
  } else if (schema.type === 'string') {
    let s = z.string()
    if (typeof schema.minLength === 'number') s = s.min(schema.minLength)
    if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength)
    out = s
  } else if (schema.type === 'number' || schema.type === 'integer') {
    let n = schema.type === 'integer' ? z.number().int() : z.number()
    if (typeof schema.minimum === 'number') n = n.min(schema.minimum)
    if (typeof schema.maximum === 'number') n = n.max(schema.maximum)
    out = n
  } else if (schema.type === 'boolean') out = z.boolean()
  else if (schema.type === 'array') {
    let a = z.array(build(schema.items as Json))
    if (typeof schema.minItems === 'number') a = a.min(schema.minItems)
    if (typeof schema.maxItems === 'number') a = a.max(schema.maxItems)
    out = a
  } else {
    const properties = (schema.properties ?? {}) as Record<string, Json>
    const required = new Set((schema.required ?? []) as string[])
    const shape: Record<string, z.ZodType> = {}
    for (const [name, child] of Object.entries(properties)) shape[name] = required.has(name) ? build(child) : build(child).optional()
    out = schema.additionalProperties === false ? z.object(shape).strict() : z.object(shape)
  }
  return description ? out.describe(description) : out
}

// The zod schema for a tool's input. Call `toolSchemaProblems` first: this assumes the schema is one it accepts.
export const schemaToZod = (schema: unknown): z.ZodType => build(schema as Json)

// The name the model sees for one tool of one plugin: the plugin's id and the tool's, so a plugin cannot shadow an app tool or another plugin's.
// "acme.kanban" + "addCard" -> "acme_kanban__addCard". Model providers allow letters, digits, "_" and "-", up to 64.
export function toolName(pluginId: string, toolId: string): string {
  return `${pluginId.replace(/[^A-Za-z0-9]/g, '_')}__${toolId}`
}

export const MAX_TOOL_NAME = 64

// The plugin a tool name belongs to, and the tool, when it was made by `toolName` (ids are lower-case words, so the split is exact only
// with the list of plugins; callers look the name up in their own table instead of parsing it).
export const isPluginToolName = (name: string) => name.includes('__')
