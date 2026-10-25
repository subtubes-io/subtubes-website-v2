# @subtubes/diagram-core

The diagram model and the one interface to change it. No UI, no storage, no history. Peer dependencies: `zod`, `zustand` (the vanilla store).

```ts
import { createDiagramController } from '@subtubes/diagram-core'

const controller = createDiagramController()

const result = controller.apply({
  ops: [
    { op: 'createNode', node: { title: 'Orders API', body: 'Takes the order.', color: 'blue' } },
    { op: 'createNode', node: { title: 'Payments', body: '' } },
    { op: 'createEdge', edge: { from: 'Orders API', to: 'Payments', label: 'charge' } },
  ],
  summary: 'Orders call payments',
  source: 'user',            // anything the host tells apart: 'user', 'agent', ...
})
// { ok: true, revision: 1, applied: 3, changed: true, patch, inverse }  or  { ok: false, error: 'invalid' | 'stale-revision', message, currentRevision }

controller.getSnapshot()      // plain data, the same object until something changes
controller.subscribe(render)  // once per change; works with React's useSyncExternalStore
```

## The controller

| | |
| --- | --- |
| `apply({ ops, summary, source, expectedRevision?, id? })` | The one way to change a diagram. All or nothing; moves the revision once; refuses (and changes nothing) if `expectedRevision` is not the current one. |
| `applyPatch(patch, { summary, source })` | Applies a patch the host kept, normally an `inverse`, as a change of its own. This is how a host undoes. |
| `onChange(listener)` | Each accepted change that changed something: `{ id, revision, summary, source, at, patch, inverse }`. A history, an autosave or an approval list hangs here. |
| `getSnapshot()` / `subscribe()` | Read the diagram as plain data, and hear about changes. |
| `load(diagram, revision?)` / `onLoad()` | Put a whole diagram in. Not a change: no event, no inverse. |
| `export()` | The diagram as a file; `serializeDiagram(file)` writes the versioned JSON. |
| `stores` | The per-kind stores a renderer subscribes to. Writing to them directly is only for a live preview that is rolled back (a drag in progress). |

## The pieces

- **Format** (`format.ts`): the versioned file (`schemaVersion` 3: nodes, groups, edges, optional `color`, optional `layer`, optional diagram `type` and group `lane` metadata), `readDiagram` (upgrades v1/v2 without changing layout, says why it cannot read one), `serializeDiagram`. Released versions are frozen; fixtures and JSON Schemas are checked in `src/fixtures`.
- **Operations** (`ops.ts`) and the **planner** (`plan.ts`): the rules for each operation, applied to a copy, answering with the new diagram and the exact inverse. Pure functions.
- **Repository** (`repository.ts`): `DiagramRepository`, `memoryRepository`, `storageRepository`, `httpRepository`, and `bindRepository(controller, repository, { id })` which loads and autosaves (a burst of changes is one save; a save over somebody else's work stops with `onConflict`).
- **Geometry, colours and highlights**: edge routing, bounds, resize rules, the colour presets, and the kinds of highlight a canvas can show (`NODE_HIGHLIGHTS`, `Highlights`), which a producer such as a scenario player and a canvas share without importing each other.

## Swimlanes

A lane is a group with `lane: { body: string, orientation: 'horizontal' | 'vertical' }`.
Set diagram `type: 'swimlane'` when constructing a new controller to retain that type even with no lanes.
`createLane`, `updateLane`, `deleteLane` and `arrangeLanes` share the normal atomic planner, validation and inverse patches.
`arrangeLanes` accepts an orientation and optional `laneIds` containing every lane exactly once.
All lanes use one orientation; changing it reflows their bounds and moves contained nodes with them.
`createNode.node.laneId` places a node inside a lane and expands the lane if needed.
Membership is geometric (node centre inside lane), not a persisted node field.
Moving a lane carries its member nodes; resizing changes only its bounds; deletion keeps nodes and edges.

## Testing your own controller or repository

```ts
import { defineControllerConformance, defineRepositoryConformance } from '@subtubes/diagram-core/testing'

defineControllerConformance('mine', () => makeMyController())
defineRepositoryConformance('mine', () => makeMyRepository())
```

Both are vitest suites. They are the contract: what `apply` must refuse, what an inverse must restore exactly, how a repository must treat a stale save.
