import { MIN_GROUP, MIN_NODE } from './plan'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type EditMode = 'move' | Handle
export type EditKind = 'node' | 'group'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const minSize = (kind: EditKind) => (kind === 'node' ? MIN_NODE : MIN_GROUP)

// The rectangle after dragging by (dx, dy) world units. A resize never goes below the minimum,
// and the edge opposite the one being dragged stays where it is.
export function dragRect(start: Rect, mode: EditMode, dx: number, dy: number, min: { w: number; h: number }): Rect {
  if (mode === 'move') return { ...start, x: Math.round(start.x + dx), y: Math.round(start.y + dy) }

  let { x, y, w, h } = start
  if (mode.includes('e')) w = Math.max(min.w, start.w + dx)
  if (mode.includes('w')) {
    w = Math.max(min.w, start.w - dx)
    x = start.x + start.w - w
  }
  if (mode.includes('s')) h = Math.max(min.h, start.h + dy)
  if (mode.includes('n')) {
    h = Math.max(min.h, start.h - dy)
    y = start.y + start.h - h
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

// Only what differs, so the change touches nothing it does not have to.
export function rectPatch(before: Rect, after: Rect): Partial<Rect> {
  const patch: Partial<Rect> = {}
  for (const key of ['x', 'y', 'w', 'h'] as const) if (before[key] !== after[key]) patch[key] = after[key]
  return patch
}
