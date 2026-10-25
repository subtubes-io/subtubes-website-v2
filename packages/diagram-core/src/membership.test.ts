import { describe, expect, it } from 'vitest'
import { membersOf } from './membership'

const node = (id: string, x: number, y: number) => ({ id, title: id, layer: 'ui' as const, x, y, w: 100, h: 50, body: '' })
const group = (id: string, x: number, y: number, w: number, h: number) => ({ id, title: id, layer: 'ui' as const, x, y, w, h })

describe('membersOf', () => {
  const g = group('g', 0, 0, 300, 200)

  it('a node belongs when its centre is inside, even if it sticks out', () => {
    const result = membersOf(g, [node('in', 10, 10), node('edge', 240, 10), node('out', 400, 10)], [])
    expect(result.nodes.map((n) => n.id)).toEqual(['in', 'edge'])
  })

  it('a group belongs only when its whole box is inside, and never itself', () => {
    const result = membersOf(g, [], [g, group('inside', 10, 10, 100, 100), group('partly', 250, 10, 100, 100)])
    expect(result.groups.map((x) => x.id)).toEqual(['inside'])
  })
})
