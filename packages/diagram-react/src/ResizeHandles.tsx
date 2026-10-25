import { HANDLES } from '@subtubes/diagram-core'
import { beginEdit } from './beginEdit'
import { useDiagram, useGroups, useNodes, useSelection, useViewport } from './context'

const LABELS: Record<string, string> = {
  n: 'top', s: 'bottom', e: 'right', w: 'left', ne: 'top right', nw: 'top left', se: 'bottom right', sw: 'bottom left',
}

// Handles on the selected node or group. They live outside the node, which clips its contents.
export function ResizeHandles() {
  const instance = useDiagram()
  const selection = useSelection((s) => s.selection)
  const rect = useNodes((s) => (selection?.kind === 'node' ? s.byId[selection.id] : undefined))
  const groupRect = useGroups((s) => (selection?.kind === 'group' ? s.byId[selection.id] : undefined))
  const scale = useViewport((s) => s.scale)
  const target = rect ?? groupRect
  if (!selection || !target || (selection.kind !== 'node' && selection.kind !== 'group')) return null

  // Keeps the handles a steady size on screen at any zoom.
  const inverse = Math.min(3, Math.max(0.75, 1 / scale))
  return (
    <div
      className="resize-box"
      style={{ left: target.x, top: target.y, width: target.w, height: target.h, ['--inv' as string]: inverse }}
    >
      {HANDLES.map((handle) => (
        <span
          key={handle}
          className={`resize-handle resize-${handle}`}
          role="presentation"
          data-handle={handle}
          title={`Resize ${LABELS[handle]}`}
          onPointerDown={(e) => beginEdit(instance, e, selection.kind as 'node' | 'group', selection.id, handle)}
        />
      ))}
    </div>
  )
}
