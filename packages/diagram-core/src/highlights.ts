// Visual emphasis a diagram can show on its nodes and edges. It says nothing about why: a scenario playing, a search, a review could all
// drive it. It is plain data, so whatever produces it (the scenario player) and whatever draws it (a canvas) agree on it here and import
// nothing of each other.

export const NODE_HIGHLIGHTS = ['active', 'visited', 'success', 'failure', 'blocked'] as const
export const EDGE_HIGHLIGHTS = ['active', 'visited'] as const

export type NodeHighlight = (typeof NODE_HIGHLIGHTS)[number]
export type EdgeHighlight = (typeof EDGE_HIGHLIGHTS)[number]

export interface Highlights {
  nodes: Record<string, NodeHighlight>
  edges: Record<string, EdgeHighlight>
  // Fade everything that is not highlighted, so the highlighted part stands out.
  dimmed?: boolean
}
