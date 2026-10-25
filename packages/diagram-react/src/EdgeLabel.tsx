import { memo } from 'react'
import { labelWidth } from '@subtubes/diagram-core'
import { useHighlights } from './context'
import { useEdgeGeometry, useIsSelected } from './hooks'

export const EdgeLabel = memo(function EdgeLabel({ id }: { id: string }) {
  const { edge, geometry } = useEdgeGeometry(id)
  const selected = useIsSelected('edge', id)
  const highlight = useHighlights((s) => s.edges[id])
  if (!edge || !geometry || !edge.label) return null

  const width = labelWidth(edge)
  const className = ['edge-label', selected ? 'selected' : '', highlight ? `hl-${highlight}` : '']
    .filter(Boolean)
    .join(' ')

  return (
    <g className={className} transform={`translate(${geometry.lx}, ${geometry.ly})`}>
      <rect x={-width / 2} y={-9} width={width} height={18} rx={4} className="label-bg" />
      <text textAnchor="middle" dy="3.5" className="label-text">
        {edge.label}
      </text>
    </g>
  )
})
