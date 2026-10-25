import type { DiagramData, DiagramFile, EdgeDef, GroupDef, Layer, NodeDef } from './format'

export type { DiagramData, DiagramFile, EdgeDef, GroupDef, Layer, NodeDef }

export type SelectionKind = 'node' | 'edge' | 'group'

export interface Selection {
  kind: SelectionKind
  id: string
}

export interface Size {
  width: number
  height: number
}

export interface Bounds {
  w: number
  h: number
}
