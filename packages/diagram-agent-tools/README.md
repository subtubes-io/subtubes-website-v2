# @subtubes/diagram-agent-tools

The tools an AI agent uses on a diagram, built from a `@subtubes/diagram-core` controller. Peer dependencies: `zod`, `@subtubes/diagram-core`.

```ts
import { callDiagramTool, createDiagramTools, describeTools } from '@subtubes/diagram-agent-tools'

const tools = createDiagramTools(controller, { source: 'agent' })

describeTools(tools)                   // [{ name, description, risk, parameters (JSON Schema) }]: what to tell a model
callDiagramTool(tools, name, input)    // runs a call the way a model makes it: by name, checked first, never throwing
tools.getDiagram.run({})               // or call one directly
```

| Tool | Does |
| --- | --- |
| `getDiagram` | ids, titles, colours and edges (`mode: 'full'` adds bodies), with the revision |
| `getSwimlanes` | spatially ordered lanes with titles, descriptions (`body`), orientation, bounds and contained node IDs, with the revision |
| `getNode` | nodes in full, by id or title |
| `searchNodes` | nodes whose title or body has some text, with an excerpt |
| `applyChanges` | one batch of operations, against the revision the agent read; refused with the reason if the diagram moved on or a change is not valid |
| `editSwimlanes` | the same atomic edit path, with lane operations plus ordinary node/edge edits in one batch |

For example, after reading revision 0 of an empty diagram:

```ts
tools.editSwimlanes.run({
  expectedRevision: 0,
  summary: 'Create an approval workflow',
  ops: [
    { op: 'createLane', lane: { id: 'customer', title: 'Customer', body: 'Submits requests', orientation: 'horizontal' } },
    { op: 'createLane', lane: { id: 'reviewer', title: 'Reviewer', body: 'Approves requests' } },
    { op: 'createNode', node: { id: 'request', title: 'Request', body: 'Order details', laneId: 'customer' } },
    { op: 'createNode', node: { id: 'approve', title: 'Approve', body: 'Review the order', laneId: 'reviewer' } },
    { op: 'createEdge', edge: { from: 'request', to: 'approve', label: 'submit' } },
  ],
})
```

Use `updateLane` to edit title, description (`body`), colour or bounds; `deleteLane` removes only the container;
`arrangeLanes` changes orientation and optionally reorders every lane with a complete `laneIds` list.
Moving a lane carries nodes whose centres lie inside it. Node titles, Markdown bodies and edges retain their ordinary operations.

- Each tool is a **spec** (`diagramToolSpecs`: name, description, `risk: 'read' | 'write'`, zod input and output) plus `run`. A host with its own tool system builds on the specs; the Subtubes app wraps them with a version and where they run (`shared/toolContracts.ts`).
- The library has **no approval step**. `risk` says which tools change the diagram, so a host can ask first; the changes it makes carry `source` and `summary` for an approval or history UI.
- `summarizeDiagram`, `findNodes` and `searchNodeText` are plain functions of plain data: they serve a saved copy (a report's diagram) the same as an open one.
