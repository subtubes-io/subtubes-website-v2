import { useDiagram, useEdges, useSelection } from './context'

// For a selected edge: a solid line or a dashed one. One undoable change each.
export function EdgeStyleControl() {
  const { controller } = useDiagram()
  const selection = useSelection((s) => s.selection)
  const edge = useEdges((s) => (selection?.kind === 'edge' ? s.byId[selection.id] : undefined))
  if (!selection || selection.kind !== 'edge' || !edge) return null
  const dashed = edge.dashed === true

  const choose = (next: boolean) => {
    if (next === dashed) return
    controller.apply({
      ops: [{ op: 'updateEdge', id: edge.id, patch: { dashed: next } }],
      summary: `Make the edge ${edge.label ? `“${edge.label}” ` : ''}${next ? 'dashed' : 'solid'}`,
      source: 'user',
    })
  }

  return (
    <div className="edge-style-control" role="group" aria-label="Line style of the selected edge" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <button type="button" className="edge-style-btn" aria-pressed={!dashed} title="Solid line" aria-label="Solid line" onClick={() => choose(false)}>
        <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
          <path d="M2 5h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="edge-style-btn" aria-pressed={dashed} title="Dashed line" aria-label="Dashed line" onClick={() => choose(true)}>
        <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true">
          <path d="M2 5h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 4" />
        </svg>
      </button>
    </div>
  )
}
