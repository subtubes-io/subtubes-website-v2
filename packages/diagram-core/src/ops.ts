import { z } from 'zod'
import { colorSchema } from './colors'
import { orientationSchema } from './format'

// The operations that change a diagram: the one vocabulary for people and for agents. A batch of them is planned (plan.ts), applied
// as a whole or not at all, and answered with the exact inverse. The descriptions are what a model reads.

const colorHelp = 'A colour: a name (red, orange, yellow, green, teal, blue, purple, pink, gray), which follows the light or dark theme, or a fixed #rrggbb. Leave out for the default.'
// In an update, null takes the colour off.
const colorPatch = colorSchema.nullable().optional().describe(`${colorHelp} null removes it.`)

const nodeDraft = z.object({
  id: z.string().optional().describe('Leave out to have one generated.'),
  title: z.string().min(1),
  color: colorSchema.optional().describe(colorHelp),
  body: z.string().describe('Markdown.'),
  x: z.number().optional(),
  y: z.number().optional(),
  laneId: z.string().optional().describe('Place this node inside this swimlane, expanding the lane if needed.'),
})

// Position and size on the canvas. Nodes may not be smaller than 160x80 and groups not smaller than 120x80.
// Giving a group only x and/or y moves it together with the nodes (and groups) drawn inside it; giving w or h resizes the box alone.
const geometryPatch = { x: z.number().optional(), y: z.number().optional(), w: z.number().positive().optional(), h: z.number().positive().optional() }

export const diagramOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('createLane'),
    lane: z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      body: z.string().default(''),
      orientation: orientationSchema.optional(),
      color: colorSchema.optional(),
      ...geometryPatch,
    }),
  }),
  z.object({
    op: z.literal('updateLane'), id: z.string(),
    patch: z.object({ title: z.string().min(1).optional(), body: z.string().optional(), color: colorPatch, ...geometryPatch }),
  }),
  z.object({ op: z.literal('deleteLane'), id: z.string() }),
  z.object({
    op: z.literal('arrangeLanes'),
    orientation: orientationSchema,
    laneIds: z.array(z.string()).optional().describe('Every lane id exactly once, in the desired order. Omit to keep the current spatial order.'),
  }),
  z.object({ op: z.literal('createNode'), node: nodeDraft }),
  z.object({
    op: z.literal('updateNode'),
    id: z.string(),
    patch: z.object({
      title: z.string().min(1).optional(),
      body: z.string().optional(),
      color: colorPatch,
      ...geometryPatch,
    }),
  }),
  z.object({ op: z.literal('deleteNode'), id: z.string() }),
  z.object({
    op: z.literal('createEdge'),
    edge: z.object({
      id: z.string().optional(),
      from: z.string().describe('A node id, or the title of a node (including one created earlier in this same batch).'),
      to: z.string().describe('A node id, or the title of a node (including one created earlier in this same batch).'),
      label: z.string(),
      dashed: z.boolean().optional(),
      optional: z.boolean().optional(),
      color: colorSchema.optional().describe(colorHelp),
    }),
  }),
  z.object({
    op: z.literal('updateEdge'),
    id: z.string(),
    patch: z.object({ label: z.string().optional(), dashed: z.boolean().optional(), optional: z.boolean().optional(), color: colorPatch }),
  }),
  z.object({ op: z.literal('deleteEdge'), id: z.string() }),
  z.object({
    op: z.literal('createGroup'),
    group: z.object({
      id: z.string().optional().describe('Leave out to have one generated.'),
      title: z.string().min(1),
      nodeIds: z.array(z.string()).default([]).describe('The nodes to draw a labelled box around, by id or by title. Leave empty for an empty box at x, y.'),
      color: colorSchema.optional().describe(colorHelp),
      ...geometryPatch,
    }),
  }),
  z.object({ op: z.literal('updateGroup'), id: z.string(), patch: z.object({ title: z.string().min(1).optional(), color: colorPatch, ...geometryPatch }) }),
  z.object({ op: z.literal('deleteGroup'), id: z.string() }),
])


export type DiagramOp = z.infer<typeof diagramOpSchema>
