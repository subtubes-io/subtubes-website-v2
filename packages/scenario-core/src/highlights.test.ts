import { describe, expect, it } from 'vitest'
import { EDGE_HIGHLIGHTS, NODE_HIGHLIGHTS } from '@subtubes/diagram-core'
import type { Highlights } from '@subtubes/diagram-core'
import { highlightsAt } from './highlights'
import type { Trace } from './types'

const trace = {
  steps: [
    { nodeId: 'a', kind: 'start' },
    { nodeId: 'b', edgeId: 'e1', kind: 'step' },
    { nodeId: 'c', edgeId: 'e2', kind: 'end', outcome: 'failure' },
  ],
} as unknown as Trace

describe('highlightsAt', () => {
  it('only ever produces kinds the diagram knows how to draw, so nothing is lit up with a style that does not exist', () => {
    for (let cursor = 0; cursor < 3; cursor++) {
      const lit: Highlights = highlightsAt(trace, cursor)
      for (const kind of Object.values(lit.nodes)) expect(NODE_HIGHLIGHTS).toContain(kind)
      for (const kind of Object.values(lit.edges)) expect(EDGE_HIGHLIGHTS).toContain(kind)
    }
  })

  it('marks what was passed, what is current, and the outcome at the end', () => {
    expect(highlightsAt(trace, 1)).toEqual({ nodes: { a: 'visited', b: 'active' }, edges: { e1: 'active' } })
    expect(highlightsAt(trace, 2).nodes.c).toBe('failure')
  })
})
