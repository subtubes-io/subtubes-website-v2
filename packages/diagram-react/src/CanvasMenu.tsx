import { useEffect, useRef } from 'react'
import { addGroupAt, addNodeAt } from './actions'
import { useDiagram } from './context'

const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export interface CanvasMenuState {
  // Where it was opened, on screen (to place the menu) and on the diagram (where the new thing goes).
  screen: { x: number; y: number }
  at: { x: number; y: number }
}

// The menu that opens when the empty canvas is right-clicked: add a node or a group at that point.
export function CanvasMenu({ menu, onClose }: { menu: CanvasMenuState; onClose: () => void }) {
  const { controller, ui } = useDiagram()
  const ref = useRef<HTMLDivElement>(null)

  // Opened with the first item ready for the keyboard; closed by Escape, a click elsewhere, or the window changing.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const close = () => onClose()
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])

  const add = (kind: 'node' | 'group') => {
    onClose()
    const id = kind === 'node' ? addNodeAt(controller, menu.at.x, menu.at.y) : addGroupAt(controller, menu.at.x, menu.at.y)
    if (!id) return
    // Straight into naming it.
    if (kind === 'node') {
      ui.selection.getState().select({ kind: 'node', id })
      ui.edit.getState().editNode(id, 'title')
    } else {
      ui.selection.getState().select({ kind: 'group', id })
      ui.edit.getState().editGroup(id)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') items[(index + 1) % items.length]?.focus()
    else if (e.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus()
    else if (e.key === 'Home') items[0]?.focus()
    else if (e.key === 'End') items[items.length - 1]?.focus()
    else return
    e.preventDefault()
  }

  // Kept on screen when opened near an edge.
  const left = Math.min(menu.screen.x, window.innerWidth - 200)
  const top = Math.min(menu.screen.y, window.innerHeight - 100)

  return (
    <div ref={ref} className="canvas-menu" role="menu" aria-label="Canvas" style={{ left, top }} onKeyDown={onKeyDown}
      // The canvas pans on a press; a press on the menu must reach its buttons instead.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => add('node')}>
        <svg {...icon}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3.3 7.5 8.7 5 8.7-5M12 22V12.5" /></svg> Add node
      </button>
      <button type="button" role="menuitem" onClick={() => add('group')}>
        <svg {...icon}><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" /><rect x="7" y="7" width="6" height="5" rx="1" /><rect x="12" y="13" width="5" height="4" rx="1" /></svg> Add group
      </button>
    </div>
  )
}
