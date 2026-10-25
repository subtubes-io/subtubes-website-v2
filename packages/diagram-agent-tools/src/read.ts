import type { EdgeDef, GroupDef, NodeDef } from '@subtubes/diagram-core'

// Reading a diagram for a model: plain functions of plain data, so they serve an open diagram and a saved copy alike.

export interface DiagramData {
  name: string
  revision: number
  type?: 'system' | 'swimlane'
  nodes: NodeDef[]
  edges: EdgeDef[]
  groups: GroupDef[]
}

export function summarizeSwimlanes(diagram: DiagramData) {
  return {
    revision: diagram.revision,
    lanes: diagram.groups.filter((g) => g.lane).map((g) => ({
      id: g.id, title: g.title, body: g.lane!.body, orientation: g.lane!.orientation,
      x: g.x, y: g.y, w: g.w, h: g.h,
      nodeIds: nodesInside(g, diagram.nodes), ...(g.color && { color: g.color }),
    })).sort((a, b) => a.orientation === 'vertical' ? a.x - b.x : a.y - b.y),
  }
}

// The ids of the nodes whose centre is inside a group's box.
export function nodesInside(group: GroupDef, nodes: NodeDef[]): string[] {
  return nodes.filter((n) => n.x + n.w / 2 >= group.x && n.x + n.w / 2 <= group.x + group.w && n.y + n.h / 2 >= group.y && n.y + n.h / 2 <= group.y + group.h).map((n) => n.id)
}

// "summary" is ids, titles, colours and edges; "full" adds every node's body.
export function summarizeDiagram(diagram: DiagramData, mode: 'summary' | 'full' = 'summary') {
  const full = mode === 'full'
  return {
    name: diagram.name,
    revision: diagram.revision,
    type: diagram.type ?? (diagram.groups.some((g) => g.lane) ? 'swimlane' : 'system'),
    lanes: summarizeSwimlanes(diagram).lanes,
    nodes: diagram.nodes.map((n) => ({ id: n.id, title: n.title, ...(n.color && { color: n.color }), ...(full && { body: n.body }) })),
    edges: diagram.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label, ...(e.color && { color: e.color }) })),
    groups: diagram.groups.map((g) => ({ id: g.id, title: g.title, nodeIds: nodesInside(g, diagram.nodes), ...(g.color && { color: g.color }) })),
  }
}

// The nodes with this id, or this title (any case; a title can match several).
export function findNodes(nodes: NodeDef[], { id, name }: { id?: string; name?: string }): NodeDef[] {
  const wanted = name?.trim().toLowerCase()
  return nodes.filter((n) => (id !== undefined && n.id === id) || (wanted !== undefined && n.title.toLowerCase() === wanted))
}

export function excerptAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - Math.floor(length / 2))
  const slice = text.slice(start, start + length).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${start + length < text.length ? '…' : ''}`
}

// Nodes whose title or body has the text, each with a short excerpt.
export function searchNodeText(nodes: NodeDef[], query: string, options: { excerpt?: number; max?: number } = {}) {
  const { excerpt = 140, max = 20 } = options
  const needle = query.toLowerCase()
  const matches: { id: string; title: string; excerpt: string }[] = []
  for (const { id, title, body } of nodes) {
    const inBody = body.toLowerCase().indexOf(needle)
    if (inBody === -1 && !title.toLowerCase().includes(needle)) continue
    matches.push({ id, title, excerpt: excerptAround(body, Math.max(inBody, 0), excerpt) })
    if (matches.length >= max) break
  }
  return { matches }
}
