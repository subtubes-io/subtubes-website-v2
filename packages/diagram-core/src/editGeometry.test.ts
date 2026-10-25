import { describe, expect, it } from 'vitest'
import { dragRect, rectPatch } from './editGeometry'

const start = { x: 100, y: 100, w: 300, h: 200 }
const min = { w: 160, h: 80 }

describe('dragRect', () => {
  it('moves without changing the size', () => {
    expect(dragRect(start, 'move', 20.4, -10.6, min)).toEqual({ x: 120, y: 89, w: 300, h: 200 })
  })

  it('resizes from the bottom right corner, keeping the top left', () => {
    expect(dragRect(start, 'se', 50, 30, min)).toEqual({ x: 100, y: 100, w: 350, h: 230 })
  })

  it('resizes from the top left corner, keeping the bottom right where it is', () => {
    const r = dragRect(start, 'nw', 40, 20, min)
    expect(r).toEqual({ x: 140, y: 120, w: 260, h: 180 })
    expect(r.x + r.w).toBe(400)
    expect(r.y + r.h).toBe(300)
  })

  it('an edge handle changes one dimension only', () => {
    expect(dragRect(start, 'e', 10, 99, min)).toEqual({ x: 100, y: 100, w: 310, h: 200 })
    expect(dragRect(start, 'n', 99, -10, min)).toEqual({ x: 100, y: 90, w: 300, h: 210 })
  })

  it('stops at the minimum size and pins the opposite edge', () => {
    expect(dragRect(start, 'se', -1000, -1000, min)).toEqual({ x: 100, y: 100, w: 160, h: 80 })
    const r = dragRect(start, 'nw', 1000, 1000, min)
    expect(r).toEqual({ x: 240, y: 220, w: 160, h: 80 })
  })
})

describe('rectPatch', () => {
  it('lists only what changed', () => {
    expect(rectPatch(start, { ...start, w: 320 })).toEqual({ w: 320 })
    expect(rectPatch(start, start)).toEqual({})
  })
})
