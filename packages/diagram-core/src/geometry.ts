import type { Bounds, EdgeDef, GroupDef, NodeDef } from './types'

export interface EdgeGeometry {
  d: string
  lx: number
  ly: number
}

function cubicAt(t: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

// Right edge to left edge when the target is in a later column, the reverse for
// earlier columns, and a bulge out the right side when both nodes share a column.
export function edgeGeometry(a: NodeDef, b: NodeDef): EdgeGeometry {
  const y1 = a.y + a.h / 2
  const y2 = b.y + b.h / 2
  let x1: number, x2: number, c1x: number, c2x: number

  if (b.x > a.x + a.w - 1) {
    x1 = a.x + a.w
    x2 = b.x
    const dx = Math.max(60, (x2 - x1) / 2)
    c1x = x1 + dx
    c2x = x2 - dx
  } else if (b.x + b.w < a.x + 1) {
    x1 = a.x
    x2 = b.x + b.w
    const dx = Math.max(60, (x1 - x2) / 2)
    c1x = x1 - dx
    c2x = x2 + dx
  } else {
    x1 = a.x + a.w
    x2 = b.x + b.w
    c1x = x1 + 90
    c2x = x2 + 90
  }

  return {
    d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`,
    lx: cubicAt(0.5, x1, c1x, c2x, x2),
    ly: cubicAt(0.5, y1, y1, y2, y2),
  }
}

export function labelWidth(edge: EdgeDef) {
  return edge.label.length * 6.2 + 16
}

// The area the diagram covers: groups are optional, so nodes count too.
export function diagramBounds(groups: GroupDef[], nodes: NodeDef[]): Bounds {
  return [...groups, ...nodes].reduce(
    (acc, g) => ({ w: Math.max(acc.w, g.x + g.w), h: Math.max(acc.h, g.y + g.h) }),
    { w: 0, h: 0 },
  )
}
