import type { Bounds } from '@subtubes/diagram-core'
import { useDiagram, useEdges, useGroups, useNodes } from './context'
import { ArrowHeads } from './ArrowHeads'
import { arrowBase } from './colors'
import { DiagramEdge } from './DiagramEdge'
import { DiagramGroup } from './DiagramGroup'
import { DiagramNode } from './DiagramNode'
import { EdgeLabel } from './EdgeLabel'

export function GroupLayer() {
  const ids = useGroups((s) => s.ids)
  return ids.map((id) => <DiagramGroup key={id} id={id} />)
}

export function EdgeLayer({ bounds }: { bounds: Bounds }) {
  const { uid } = useDiagram()
  const ids = useEdges((s) => s.ids)
  const byId = useEdges((s) => s.byId)
  return (
    <svg className="edges" width={bounds.w} height={bounds.h} aria-hidden="true">
      <defs>
        <ArrowHeads id={arrowBase(uid)} colors={ids.map((id) => byId[id].color)} />
      </defs>
      {ids.map((id) => (
        <DiagramEdge key={id} id={id} />
      ))}
    </svg>
  )
}

export function NodeLayer() {
  const ids = useNodes((s) => s.ids)
  return ids.map((id) => <DiagramNode key={id} id={id} />)
}

// Drawn above the nodes so labels are never hidden behind them.
export function EdgeLabelLayer({ bounds }: { bounds: Bounds }) {
  const ids = useEdges((s) => s.ids)
  return (
    <svg className="labels" width={bounds.w} height={bounds.h} aria-hidden="true">
      {ids.map((id) => (
        <EdgeLabel key={id} id={id} />
      ))}
    </svg>
  )
}
