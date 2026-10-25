import { memo } from 'react'
import { useDiagram, useHighlights } from './context'
import { arrowBase, arrowId, edgeColor, edgeStyle } from './colors'
import { useEdgeGeometry, useIsSelected } from './hooks'

export const DiagramEdge = memo(function DiagramEdge({ id }: { id: string }) {
  const instance = useDiagram()
  const { edge, geometry } = useEdgeGeometry(id)
  const selected = useIsSelected('edge', id)
  const highlight = useHighlights((s) => s.edges[id])
  if (!edge || !geometry) return null

  const className = [
    'edge',
    edge.dashed ? 'dashed' : '',
    edge.optional ? 'optional' : '',
    edgeColor(edge.color) ? 'colored' : '',
    selected ? 'selected' : '',
    highlight ? `hl-${highlight}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <g>
      <path d={geometry.d} className={className} style={edgeStyle(edge.color)} markerEnd={`url(#${arrowId(arrowBase(instance.uid), edge.color)})`} />
      {/* Wide invisible stroke so thin lines are easy to click. */}
      <path
        d={geometry.d}
        className="edge-hit"
        onPointerDown={(e) => {
          e.stopPropagation()
          instance.ui.selection.getState().select({ kind: 'edge', id })
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          instance.ui.edit.getState().editEdge(id)
        }}
      />
    </g>
  )
})
