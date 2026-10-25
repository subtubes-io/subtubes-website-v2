import { diagramOpSchema } from '@subtubes/diagram-core'
import { z } from 'zod'

// What each tool is, apart from how it runs: its name, what a model reads about it, whether it only reads, and the exact shape of what it takes
// and gives back. A host that has its own tool system (the Subtubes app wraps these with a version and where they run) builds on these, so
// every host offers a model the same tools.

export interface DiagramToolSpec<I = unknown, O = unknown> {
  name: string
  description: string
  // 'read' tools only look; 'write' tools change the diagram, so a host may ask first.
  risk: 'read' | 'write'
  input: z.ZodType<I>
  output: z.ZodType<O>
}

const spec = <I, O>(s: DiagramToolSpec<I, O>): DiagramToolSpec<I, O> => s

const diagramNode = z.object({
  id: z.string(),
  title: z.string(),
  layer: z.string().optional(),
  color: z.string().optional(),
  body: z.string().optional(),
})

const swimlane = z.object({
  id: z.string(), title: z.string(), body: z.string(),
  orientation: z.enum(['horizontal', 'vertical']),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  nodeIds: z.array(z.string()), color: z.string().optional(),
})

export const getSwimlanesSpec = spec({
  name: 'getSwimlanes',
  description: 'Read swimlane ids, titles, descriptions, orientation, bounds and member node ids. Membership is geometric: a node belongs to a lane when its centre is inside it. Use editSwimlanes to change lanes and their nodes.',
  risk: 'read',
  input: z.object({}),
  output: z.object({ revision: z.number().int(), lanes: z.array(swimlane) }),
})

export const getDiagramSpec = spec({
  name: 'getDiagram',
  description:
    'Get the current diagram. "summary" returns ids, titles, colours and the edges; "full" also returns every node body. Start with the summary and fetch bodies with getNode as needed.',
  risk: 'read',
  input: z.object({ mode: z.enum(['summary', 'full']).optional() }),
  output: z.object({
    name: z.string(),
    revision: z.number().int(),
    type: z.enum(['system', 'swimlane']).optional(),
    lanes: z.array(swimlane).optional(),
    nodes: z.array(diagramNode),
    edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string(), color: z.string().optional() })),
    groups: z.array(z.object({ id: z.string(), title: z.string(), nodeIds: z.array(z.string()), color: z.string().optional() })).optional(),
  }),
})

export const getNodeSpec = spec({
  name: 'getNode',
  description: 'Get one or more diagram nodes in full, by id or by title. A title can match several nodes; all matches are returned.',
  risk: 'read',
  input: z.object({ id: z.string().optional(), name: z.string().optional() }).refine((v) => v.id !== undefined || v.name !== undefined, 'Give an id or a name'),
  output: z.object({ nodes: z.array(diagramNode.extend({ x: z.number(), y: z.number() })) }),
})

export const searchNodesSpec = spec({
  name: 'searchNodes',
  description: 'Search diagram node titles and bodies for text. Returns matching nodes with a short excerpt.',
  risk: 'read',
  input: z.object({ query: z.string().min(1) }),
  output: z.object({ matches: z.array(z.object({ id: z.string(), title: z.string(), excerpt: z.string() })) }),
})

export const applyChangesSpec = spec({
  name: 'applyChanges',
  description:
    'Change the diagram: create, update or delete nodes, edges, groups and swimlanes, as ONE atomic batch. Swimlane operations: createLane (title, body, orientation, optional bounds), updateLane, deleteLane (keeps its nodes), arrangeLanes (orientation and optional complete ordered laneIds). createNode accepts laneId to place a node in a lane and expand it. Moving a lane carries its contents. Pass the revision you read (from getDiagram) as expectedRevision; if the diagram changed since, nothing is applied and you must re-read and retry. Deleting or making many changes asks the user for approval first.',
  risk: 'write',
  input: z.object({
    expectedRevision: z.number().int().min(0),
    summary: z.string().min(1).describe('A short description of the change, shown to the user for approval and in history.'),
    ops: z.array(diagramOpSchema).min(1).max(50),
  }),
  output: z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      revision: z.number().int(),
      applied: z.number().int(),
      // How many revisions the diagram moved on while this waited for approval (changes made by someone else that did not touch what this changes).
      rebasedOver: z.number().int().optional(),
    }),
    z.object({
      ok: z.literal(false),
      error: z.enum(['stale-revision', 'invalid', 'rejected']),
      message: z.string(),
      currentRevision: z.number().int().optional(),
    }),
  ]),
})

export const editSwimlanesSpec = spec({
  ...applyChangesSpec,
  name: 'editSwimlanes',
  description: 'Design swimlanes and their editable nodes and edges in one atomic, undoable batch. Read getSwimlanes or getDiagram for expectedRevision and ids. Use createLane, updateLane, deleteLane, arrangeLanes, and createNode with laneId. Nodes have title and Markdown body; edges use the same operations as system diagrams. Deleting a lane keeps its nodes. Reordering or changing orientation carries nodes with their lane. The same validation and approval policy as applyChanges applies.',
})

export const diagramToolSpecs = {
  getDiagram: getDiagramSpec,
  getNode: getNodeSpec,
  searchNodes: searchNodesSpec,
  applyChanges: applyChangesSpec,
  getSwimlanes: getSwimlanesSpec,
  editSwimlanes: editSwimlanesSpec,
}

export type DiagramToolName = keyof typeof diagramToolSpecs
