import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { diagramBounds } from '@subtubes/diagram-core'
import { deleteEdge, deleteGroup, deleteNode } from './actions'
import { useDiagram, useGroups, useHighlights, useNodes, useViewport } from './context'
import { EdgeEditor } from './EdgeEditor'
import { GroupEditor } from './GroupEditor'
import { ConnectHandles, ConnectPreview } from './ConnectHandles'
import { CanvasMenu } from './CanvasMenu'
import type { CanvasMenuState } from './CanvasMenu'
import { toDiagram } from './beginConnect'
import { ResizeHandles } from './ResizeHandles'
import { EdgeLabelLayer, EdgeLayer, GroupLayer, NodeLayer } from './DiagramLayers'
import { DiagramToolbar } from './DiagramToolbar'
import { ZoomControls } from './ZoomControls'

const GRID = 24
// Pointer travel under this many pixels counts as a click, not a pan.
const CLICK_SLOP = 3

interface DragState {
  px: number
  py: number
  vx: number
  vy: number
  moved: boolean
}

// `designKey` changes when a different diagram is shown, so the view is fitted to it again. `empty` is what the canvas says when there is
// nothing on it at all (no nodes and no groups).
export function DiagramCanvas({ title, designKey, empty: emptyMessage }: { title: string; designKey?: string | number; empty?: ReactNode }) {
  const instance = useDiagram()
  const { controller, ui } = instance
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<DragState | null>(null)
  const [menu, setMenu] = useState<CanvasMenuState | null>(null)

  const x = useViewport((s) => s.x)
  const y = useViewport((s) => s.y)
  const scale = useViewport((s) => s.scale)
  const panning = useViewport((s) => s.panning)

  const groupsById = useGroups((s) => s.byId)
  const dimmed = useHighlights((s) => s.dimmed)
  // Empty means nothing at all: a diagram of only groups is not empty.
  const noNodes = useNodes((s) => s.ids.length === 0)
  const noGroups = useGroups((s) => s.ids.length === 0)
  const empty = noNodes && noGroups
  const nodesById = useNodes((s) => s.byId)
  const bounds = useMemo(() => diagramBounds(Object.values(groupsById), Object.values(nodesById)), [groupsById, nodesById])

  const size = useCallback(() => {
    const el = ref.current
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 }
  }, [])

  const fit = useCallback(() => ui.viewport.getState().fit(size(), bounds), [ui, size, bounds])

  const zoomCenter = useCallback(
    (factor: number) => {
      const { width, height } = size()
      ui.viewport.getState().zoomAround(factor, width / 2, height / 2)
    },
    [ui, size],
  )

  useLayoutEffect(() => {
    // The first layout, and each time another diagram is shown; other bounds changes (the assistant
    // adding a node) must not reset the user's view.
    ui.viewport.getState().reset(size(), bounds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey])

  // Native listener so preventDefault works: pinch / ctrl+wheel zooms, plain wheel pans.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    instance.surface.el = el
    const onWheel = (e: WheelEvent) => {
      // A text box being edited scrolls itself.
      if ((e.target as HTMLElement | null)?.closest?.('textarea')) return
      e.preventDefault()
      const viewport = ui.viewport.getState()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        viewport.zoomAround(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        viewport.panBy(-e.deltaX, -e.deltaY)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (instance.surface.el === el) instance.surface.el = null
    }
  }, [instance, ui])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.selection.getState().clearSelection()
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      // Only when nothing else has the keyboard: not a text field, and not a list that has its own Delete.
      const target = e.target as HTMLElement | null
      if (target && target !== document.body && !ref.current?.contains(target)) return
      const { selection } = ui.selection.getState()
      if (!selection) return
      e.preventDefault()
      if (selection.kind === 'node') deleteNode(controller, selection.id)
      else if (selection.kind === 'group') deleteGroup(controller, selection.id)
      else deleteEdge(controller, selection.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller, ui])

  // Right-click on empty canvas opens the add menu. On a node, group or edge nothing special happens (but the browser's
  // own menu is not shown over the diagram), and in a text box being edited the browser's menu (copy, paste) is left alone.
  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, [contenteditable]')) return
    e.preventDefault()
    if (target.closest('.node, .group-bar, .group-edge, .edge-hit, .resize-handle, .connect-handle, .canvas-head, .zoom, .canvas-empty')) {
      setMenu(null)
      return
    }
    setMenu({ screen: { x: e.clientX, y: e.clientY }, at: toDiagram(instance, e.clientX, e.clientY) })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x: vx, y: vy, setPanning } = ui.viewport.getState()
    drag.current = { px: e.clientX, py: e.clientY, vx, vy, moved: false }
    setPanning(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) d.moved = true
    ui.viewport.getState().setPosition(d.vx + dx, d.vy + dy)
  }

  const endDrag = () => {
    const d = drag.current
    drag.current = null
    ui.viewport.getState().setPanning(false)
    // A click on empty canvas clears the selection.
    if (d && !d.moved) ui.selection.getState().clearSelection()
  }

  return (
    <section
      ref={ref}
      className={panning ? 'canvas dragging' : 'canvas'}
      style={{
        backgroundSize: `${GRID * scale}px ${GRID * scale}px`,
        backgroundPosition: `${x}px ${y}px`,
      }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <DiagramToolbar title={title} />
      {menu && <CanvasMenu menu={menu} onClose={() => setMenu(null)} />}

      <div
        className={dimmed ? 'world focus' : 'world'}
        style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
      >
        <GroupLayer />
        <EdgeLayer bounds={bounds} />
        <NodeLayer />
        <EdgeLabelLayer bounds={bounds} />
        <ResizeHandles />
        <ConnectHandles />
        <ConnectPreview />
        <EdgeEditor />
        <GroupEditor />
      </div>

      {empty && (
        <div className="canvas-empty" role="note">
          {emptyMessage ?? <strong>This diagram is empty</strong>}
        </div>
      )}

      <ZoomControls config={{ onZoom: zoomCenter, onFit: fit }} />
    </section>
  )
}
