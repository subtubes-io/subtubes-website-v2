import { z } from 'zod'
import { colorSchema } from './colors'
import { defineFormat, readVersioned, readVersionedOrThrow, serializeVersioned } from './versioning'

// Bump when the serialized shape changes in a way old files can't satisfy.
export const DIAGRAM_SCHEMA_VERSION = 3

// Layers were the only way to colour a node in v1. From v2 a layer is an optional label and a colour is its own setting.
export const LAYERS = ['ui', 'runtime', 'tools', 'domain'] as const
export const layerSchema = z.enum(LAYERS)

export { colorSchema }

const idSchema = z.string().min(1)
const coordinate = z.number().finite()
const dimension = z.number().finite().positive()

export const groupV1Schema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  layer: layerSchema,
  x: coordinate,
  y: coordinate,
  w: dimension,
  h: dimension,
})

export const nodeV1Schema = z.strictObject({
  id: idSchema,
  title: z.string().min(1),
  layer: layerSchema,
  x: coordinate,
  y: coordinate,
  w: dimension,
  h: dimension,
  // Markdown (GFM) with fenced code blocks.
  body: z.string(),
})

export const edgeV1Schema = z.strictObject({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  label: z.string(),
  // Asynchronous event rather than a direct call.
  dashed: z.boolean().optional(),
  // Optional AI assistance rather than a required step.
  optional: z.boolean().optional(),
})

function findDuplicates(ids: string[]) {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  return [...dupes]
}

// The checks both versions share: ids are unique and an edge joins nodes that exist.
function checkDiagram(
  diagram: { groups: { id: string }[]; nodes: { id: string }[]; edges: { id: string; from: string; to: string }[] },
  ctx: z.RefinementCtx,
) {
  const collections = [
    ['groups', diagram.groups],
    ['nodes', diagram.nodes],
    ['edges', diagram.edges],
  ] as const

  for (const [key, items] of collections) {
    for (const id of findDuplicates(items.map((item) => item.id))) {
      ctx.addIssue({ code: 'custom', path: [key], message: `Duplicate ${key} id "${id}"` })
    }
  }

  const nodeIds = new Set(diagram.nodes.map((n) => n.id))
  diagram.edges.forEach((edge, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!nodeIds.has(edge[end])) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i, end],
          message: `Edge "${edge.id}" references unknown node "${edge[end]}"`,
        })
      }
    }
  })
}

// Version 1 of the file format. Frozen: a released schema is never edited. A breaking change adds
// a new version (and a migration) in `diagramFormat` below instead.
export const diagramV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    groups: z.array(groupV1Schema),
    nodes: z.array(nodeV1Schema),
    edges: z.array(edgeV1Schema),
  })
  .superRefine(checkDiagram)

// Version 2: a node, group or edge may have its own colour, and a layer is optional (a node needs none).
export const groupV2Schema = groupV1Schema.extend({ layer: layerSchema.optional(), color: colorSchema.optional() })
export const nodeSchema = nodeV1Schema.extend({ layer: layerSchema.optional(), color: colorSchema.optional() })
export const edgeSchema = edgeV1Schema.extend({ color: colorSchema.optional() })

export const diagramV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    name: z.string().min(1),
    description: z.string().optional(),
    groups: z.array(groupV2Schema),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
  })
  .superRefine(checkDiagram)

export const orientationSchema = z.enum(['horizontal', 'vertical'])
export const groupSchema = groupV2Schema.extend({
  lane: z.object({ body: z.string(), orientation: orientationSchema }).optional(),
})
export const diagramV3Schema = z.strictObject({
  schemaVersion: z.literal(DIAGRAM_SCHEMA_VERSION),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['system', 'swimlane']).optional(),
  groups: z.array(groupSchema),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
}).superRefine(checkDiagram)

export type LaneOrientation = z.infer<typeof orientationSchema>
export type DiagramType = 'system' | 'swimlane'
export type Layer = z.infer<typeof layerSchema>
export type Color = z.infer<typeof colorSchema>
export type GroupDef = z.infer<typeof groupSchema>
export type NodeDef = z.infer<typeof nodeSchema>
export type EdgeDef = z.infer<typeof edgeSchema>
export type DiagramFile = z.infer<typeof diagramSchema>

// The part of a diagram the stores hold: everything except file metadata.
export type DiagramData = Pick<DiagramFile, 'groups' | 'nodes' | 'edges' | 'type'>

// The schema of the current version.
export const diagramSchema = diagramV3Schema

const LAYER_COLOR = { ui: 'blue', runtime: 'purple', tools: 'orange', domain: 'green' } as const

function upgradeV1(data: z.infer<typeof diagramV1Schema>) {
  const colored = <T extends { layer: Layer }>(item: T) => ({ ...item, color: LAYER_COLOR[item.layer] })
  return { data: { ...data, schemaVersion: 2, groups: data.groups.map(colored), nodes: data.nodes.map(colored) } }
}

// Every version the app can read, oldest first, ending with the current one.
export const diagramFormat = defineFormat<DiagramFile>({
  name: 'diagram',
  history: [
    // Nodes and groups were coloured by their layer. Each is given that layer's colour, so a v1 diagram looks the same and a
    // colour is from then on its own setting.
    { version: 1, schema: diagramV1Schema, migrate: upgradeV1 },
    { version: 2, schema: diagramV2Schema, migrate: (data) => ({ data: { ...data, schemaVersion: 3 } }) },
    { version: 3, schema: diagramV3Schema },
  ],
})

// Throws a typed error (see shared/versioning); use for trusted input like bundled samples.
export function parseDiagram(input: unknown): DiagramFile {
  return readVersionedOrThrow(diagramFormat, input)
}

// Returns a result instead of throwing; use for user-supplied files. Older versions are
// upgraded on the way in, with any warnings reported.
export function readDiagram(input: unknown) {
  return readVersioned(diagramFormat, input)
}

export function parseDiagramJson(text: string): DiagramFile {
  return parseDiagram(JSON.parse(text))
}

// Always writes the current version.
export function serializeDiagram(diagram: DiagramFile): string {
  return serializeVersioned(diagramFormat, diagram)
}
