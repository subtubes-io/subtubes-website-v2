import type { ApplyResult, DiagramController } from '@subtubes/diagram-core'
import { z } from 'zod'
import { findNodes, searchNodeText, summarizeDiagram, summarizeSwimlanes } from './read'
import { diagramToolSpecs } from './specs'
import type { DiagramToolName, DiagramToolSpec } from './specs'

// The tools of one diagram. Each has the spec (what a model reads and the shapes) and `run`: a plain function from the tool's input to its
// output, so any host can offer them to a model in its own way (a tool-calling API, MCP, an HTTP endpoint, a test).

export interface RunContext {
  // The host's id for the change (a tool call id, say), kept with it in whatever history the host has.
  id?: string
}

export interface DiagramTool<I = unknown, O = unknown> extends DiagramToolSpec<I, O> {
  run(input: I, context?: RunContext): O
}

export interface DiagramToolOptions {
  // Who the changes are from, as the controller records it. Default 'agent'.
  source?: string
}

type Input<N extends DiagramToolName> = z.infer<(typeof diagramToolSpecs)[N]['input']>
type Output<N extends DiagramToolName> = z.infer<(typeof diagramToolSpecs)[N]['output']>

export type DiagramTools = { [N in DiagramToolName]: DiagramTool<Input<N>, Output<N>> }

const failure = (result: Extract<ApplyResult, { ok: false }>) => ({ ok: false as const, error: result.error, message: result.message, currentRevision: result.currentRevision })

export function createDiagramTools(controller: DiagramController, options: DiagramToolOptions = {}): DiagramTools {
  const source = options.source ?? 'agent'
  const apply: DiagramTools['applyChanges']['run'] = ({ ops, summary, expectedRevision }, context) => {
    const result = controller.apply({ ops, summary, source, expectedRevision, id: context?.id })
    if (!result.ok) return failure(result)
    return { ok: true as const, revision: result.revision, applied: result.applied }
  }
  return {
    getSwimlanes: { ...diagramToolSpecs.getSwimlanes, run: () => summarizeSwimlanes(controller.getSnapshot()) },
    editSwimlanes: { ...diagramToolSpecs.editSwimlanes, run: apply },
    getDiagram: {
      ...diagramToolSpecs.getDiagram,
      run: ({ mode }) => summarizeDiagram(controller.getSnapshot(), mode),
    },
    getNode: {
      ...diagramToolSpecs.getNode,
      run: ({ id, name }) => {
        const matches = findNodes(controller.getSnapshot().nodes, { id, name })
        if (matches.length === 0) {
          throw new Error(`No node matches ${id !== undefined ? `id "${id}"` : `name "${name}"`}. Use searchNodes or getDiagram to find it.`)
        }
        return { nodes: matches.map(({ id: nodeId, title, color, body, x, y }) => ({ id: nodeId, title, ...(color && { color }), body, x, y })) }
      },
    },
    searchNodes: {
      ...diagramToolSpecs.searchNodes,
      run: ({ query }) => searchNodeText(controller.getSnapshot().nodes, query),
    },
    applyChanges: {
      ...diagramToolSpecs.applyChanges,
      run: apply,
    },
  }
}

// The tools as a model is told about them: name, description and the input as JSON Schema. The shape most tool-calling APIs and MCP take.
export function describeTools(tools: Partial<DiagramTools>) {
  return Object.values(tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    parameters: z.toJSONSchema(tool.input as z.ZodType),
  }))
}

// Runs a tool by name, checking the input first. For a host that receives calls from a model as {name, arguments}.
export function callDiagramTool(tools: DiagramTools, name: string, input: unknown, context?: RunContext): { ok: true; output: unknown } | { ok: false; message: string } {
  const tool = (tools as Record<string, DiagramTool | undefined>)[name]
  if (!tool) return { ok: false, message: `There is no tool “${name}”. The tools are ${Object.keys(tools).join(', ')}.` }
  const parsed = tool.input.safeParse(input)
  if (!parsed.success) return { ok: false, message: `The input for ${name} is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.` }
  try {
    return { ok: true, output: tool.run(parsed.data, context) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
