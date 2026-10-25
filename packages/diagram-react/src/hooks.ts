import { useMemo } from 'react'
import { edgeGeometry } from '@subtubes/diagram-core'
import type { SelectionKind } from '@subtubes/diagram-core'
import { useEdges, useNodes, useSelection } from './context'

export function useIsSelected(kind: SelectionKind, id: string) {
  return useSelection((s) => s.selection?.kind === kind && s.selection.id === id)
}

// An edge's path depends only on its two end nodes, so only edges attached to a moved node recompute.
export function useEdgeGeometry(id: string) {
  const edge = useEdges((s) => s.byId[id])
  const from = useNodes((s) => (edge ? s.byId[edge.from] : undefined))
  const to = useNodes((s) => (edge ? s.byId[edge.to] : undefined))
  const geometry = useMemo(() => (from && to ? edgeGeometry(from, to) : null), [from, to])
  return { edge, geometry }
}
