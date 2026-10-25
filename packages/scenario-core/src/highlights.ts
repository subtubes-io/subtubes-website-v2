import type { EdgeHighlight, Highlights, NodeHighlight } from '@subtubes/diagram-core'
import type { Trace } from './types'

// The shape of what is lit up belongs to the diagram (@subtubes/diagram-core), so the canvas and this agree on it.
export type { EdgeHighlight, Highlights, NodeHighlight }

const OUTCOME_HIGHLIGHT = { success: 'success', failure: 'failure', blocked: 'blocked' } as const

// What the host should light up on its diagram for the steps played so far. Pure data,
// so the diagram never needs to import the simulator.
export function highlightsAt(trace: Trace, cursor: number): Highlights {
  const nodes: Highlights['nodes'] = {}
  const edges: Highlights['edges'] = {}

  for (let i = 0; i <= cursor && i < trace.steps.length; i++) {
    const step = trace.steps[i]
    nodes[step.nodeId] = 'visited'
    if (step.edgeId) edges[step.edgeId] = 'visited'
  }

  const current = trace.steps[cursor]
  if (current) {
    const outcome = current.kind === 'end' ? current.outcome : undefined
    nodes[current.nodeId] = outcome && outcome !== 'stopped' ? OUTCOME_HIGHLIGHT[outcome] : 'active'
    if (current.edgeId) edges[current.edgeId] = 'active'
  }
  return { nodes, edges }
}
