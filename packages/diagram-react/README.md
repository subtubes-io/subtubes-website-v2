# @subtubes/diagram-react

The default React canvas for a `@subtubes/diagram-core` controller: pan and zoom, nodes, groups and edges, drag and resize, connect by dragging, edit in place, colours, a right-click menu, and a read-only viewer. Peer dependencies: `react`, `zustand`, `@subtubes/diagram-core`.

```tsx
import { createDiagramController } from '@subtubes/diagram-core'
import { DiagramCanvas, DiagramProvider, createDiagramInstance } from '@subtubes/diagram-react'
import '@subtubes/diagram-react/theme.css'     // default colours; skip it if the host defines the variables itself
import '@subtubes/diagram-react/diagram.css'

const controller = createDiagramController()
const instance = createDiagramInstance(controller)   // one per diagram on the page

<DiagramProvider instance={instance} slots={{ renderMarkdown }}>
  <DiagramCanvas title="Orders" designKey="orders" empty={<strong>Nothing here yet</strong>} />
</DiagramProvider>
```

- **What a person does is a change to the diagram**: each drag, resize, connect, edit, colour choice and delete is one `controller.apply({ source: 'user' })`. A host sees them all in `controller.onChange`.
- **`DiagramInstance`** = a controller and the canvas state for it (view, selection, edit in progress, connect, highlights). When the diagram changes or another is loaded, the canvas lets go of what it can no longer show.
- **Slots**: `renderMarkdown(source)` draws a node's content (plain text without it).
  Optional `openNodeContent(id)` adds a keyboard-accessible expand icon to editable nodes and calls the host to show the
  full content, without dragging the node or starting inline editing. The host owns its drawer and edit/save UI.
  The `empty` prop is what the canvas says when there is nothing on it.
- **Hooks** for building around it: `useDiagram`, `useNodes`, `useEdges`, `useGroups`, `useMeta`, `useSelection`, `useViewport`, ... Each reads one slice of one store. `bindStore(api)` makes a global-style hook for code written that way.
- **`DiagramViewer`**: a diagram from a file with no controller: pan, zoom, highlights. For saved copies, previews, pages that only show.
- **Theme**: the canvas reads CSS variables only. `theme.css` lists them with light and dark values. Colour presets are `--c-red` ... `--c-gray`; a node's own `#rrggbb` is used as it is.

Known issues: [docs/known-issues.md](docs/known-issues.md).
