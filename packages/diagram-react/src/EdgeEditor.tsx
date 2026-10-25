import { useEffect, useRef, useState } from 'react'
import { LIMITS, edgeGeometry } from '@subtubes/diagram-core'
import { useDiagram, useEdges, useEditing, useNodes } from './context'

// Edits an edge's label on the edge. Enter or clicking away saves (one undoable change); Escape discards.
export function EdgeEditor() {
  const id = useEditing((s) => s.edge)
  const edge = useEdges((s) => (id ? s.byId[id] : undefined))
  const from = useNodes((s) => (edge ? s.byId[edge.from] : undefined))
  const to = useNodes((s) => (edge ? s.byId[edge.to] : undefined))
  if (!id || !edge || !from || !to) return null
  const { lx, ly } = edgeGeometry(from, to)
  return <LabelInput key={id} id={id} label={edge.label} at={{ x: lx, y: ly }} />
}

function LabelInput({ id, label, at }: { id: string; label: string; at: { x: number; y: number } }) {
  const { controller, ui } = useDiagram()
  const [value, setValue] = useState(label)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save && value !== label) {
      controller.apply({ ops: [{ op: 'updateEdge', id, patch: { label: value.trim() } }], summary: 'Edit edge label', source: 'user' })
    }
    ui.edit.getState().end()
  }

  return (
    <input
      ref={ref}
      className="edge-edit"
      aria-label="Edge label"
      value={value}
      maxLength={LIMITS.label}
      placeholder="Label"
      style={{ left: at.x, top: at.y, width: Math.max(120, value.length * 7 + 28) }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
