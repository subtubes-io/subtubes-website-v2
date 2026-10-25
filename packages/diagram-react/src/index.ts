// @subtubes/diagram-react: the default React canvas for a @subtubes/diagram-core controller. See ../README.md.
//
//   const controller = createDiagramController()
//   const instance = createDiagramInstance(controller)
//   <DiagramProvider instance={instance} slots={{ renderMarkdown }}><DiagramCanvas title="Orders" /></DiagramProvider>
//
// Import '@subtubes/diagram-react/diagram.css' for the canvas's styles (and theme.css for default colours, if the host has none).
export { addGroupAt, addNodeAt, deleteEdge, deleteGroup, deleteNode } from './actions'
export { ArrowHeads } from './ArrowHeads'
export { connectNodes } from './beginConnect'
export { COLOR_PRESETS, colorCss, colorLabel, edgeStyle, layerStyle } from './colors'
export { ColorControl } from './ColorControl'
export { bindStore, useConnecting, useDiagram, useEdges, useEditing, useGroups, useHighlights, useMeta, useNodes, useSelection, useSlots, useViewport } from './context'
export type { DiagramSlots } from './context'
export { DiagramProvider } from './DiagramProvider'
export { DiagramCanvas } from './DiagramCanvas'
export { DiagramEdge } from './DiagramEdge'
export { DiagramGroup } from './DiagramGroup'
export { DiagramNode } from './DiagramNode'
export { DiagramToolbar } from './DiagramToolbar'
export { EdgeStyleControl } from './EdgeStyleControl'
export { DiagramViewer } from './DiagramViewer'
export type { DiagramViewerConfig } from './DiagramViewer'
export { EdgeLabel } from './EdgeLabel'
export { createDiagramInstance } from './instance'
export type { DiagramInstance } from './instance'
export { createCanvasUi, MAX_SCALE, MIN_SCALE } from './ui'
export type { CanvasUi, ConnectState, EditState, HighlightState, SelectionState, ViewportState } from './ui'
export { ZoomControls } from './ZoomControls'
