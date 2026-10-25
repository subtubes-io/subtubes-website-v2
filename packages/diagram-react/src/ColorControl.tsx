import { useEffect, useRef } from 'react'
import type { DiagramOp } from '@subtubes/diagram-core'
import { useDiagram, useEdges, useGroups, useNodes, useSelection } from './context'
import { COLOR_PRESETS, colorCss, colorLabel, isPreset } from './colors'

const KIND_LABEL = { node: 'node', group: 'group', edge: 'edge' } as const

// Chooses the colour of the selected node, group or edge: a preset (which follows the light or dark theme), a colour of
// your own, or none. Each choice is one undoable change.
export function ColorControl() {
  const { controller } = useDiagram()
  const selection = useSelection((s) => s.selection)
  const item = useNodes((s) => (selection?.kind === 'node' ? s.byId[selection.id] : undefined))
  const group = useGroups((s) => (selection?.kind === 'group' ? s.byId[selection.id] : undefined))
  const edge = useEdges((s) => (selection?.kind === 'edge' ? s.byId[selection.id] : undefined))
  const custom = useRef<HTMLInputElement>(null)
  const current = (item ?? group ?? edge)?.color
  const name = item?.title ?? group?.title ?? edge?.label ?? 'edge'

  const choose = (color: string | null) => {
    if (!selection || color === (current ?? null)) return
    const { id } = selection
    const op: DiagramOp = selection.kind === 'node' ? { op: 'updateNode', id, patch: { color } } : selection.kind === 'group' ? { op: 'updateGroup', id, patch: { color } } : { op: 'updateEdge', id, patch: { color } }
    controller.apply({ ops: [op], summary: `${color === null ? 'Remove the color of' : 'Color'} ${KIND_LABEL[selection.kind]} “${name}”`, source: 'user' })
  }

  // The picker reports every step while it is dragged; only the colour it settles on is a change.
  const latest = useRef(choose)
  useEffect(() => {
    latest.current = choose
  })
  useEffect(() => {
    const input = custom.current
    if (!input) return
    const onChange = () => latest.current(input.value.toLowerCase())
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [selection])

  // The picker shows the colour of your own that the selection has, if it has one.
  useEffect(() => {
    if (custom.current && current && !isPreset(current)) custom.current.value = current
  }, [current, selection])

  if (!selection || !(item ?? group ?? edge)) return null
  const isOwn = current !== undefined && !isPreset(current)

  return (
    <div
      className="color-control"
      role="group"
      aria-label={`Color of the selected ${KIND_LABEL[selection.kind]}`}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <button type="button" className="color-swatch none" aria-label="Default color" aria-pressed={current === undefined} title="Default color" onClick={() => choose(null)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M5.6 5.6l12.8 12.8" />
        </svg>
      </button>
      {COLOR_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          className="color-swatch"
          style={{ background: colorCss(preset) }}
          aria-label={colorLabel(preset)}
          aria-pressed={current === preset}
          title={colorLabel(preset)}
          onClick={() => choose(preset)}
        />
      ))}
      <label className={`color-swatch custom${isOwn ? ' on' : ''}`} title="Choose another color">
        <input ref={custom} type="color" aria-label="Custom color" defaultValue="#3b82f6" />
      </label>
    </div>
  )
}
