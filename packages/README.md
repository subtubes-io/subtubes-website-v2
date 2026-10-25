# The diagram packages

The diagram canvas is built as packages that the Subtubes app uses, so another app can use them too, and a different canvas can take the place of ours.

```
                       a host: the Subtubes app, or any other app
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ adapters it supplies: where diagrams are kept · Markdown · undo/approval  │
   └─────────────┬────────────────────────────┬───────────────────────────────┘
                 │                            │
   ┌─────────────▼────────────┐   ┌───────────▼────────────┐   ┌──────────────────────────┐
   │ diagram-core (no UI)     │◄──┤ diagram-react          │   │ diagram-agent-tools      │
   │ file format, operations, │   │ the default canvas,    │   │ the tools an AI agent    │
   │ planner with exact undo, │   │ a viewer, per-canvas   │   │ uses: read, search,      │
   │ DiagramController,       │◄──┤ state, theme           │   │ change                   │
   │ DiagramRepository        │◄──────────────────────────────┤ (built from a controller)│
   └──────────────────────────┘   └────────────────────────┘   └──────────────────────────┘
```

| Package | What it is | Depends on |
| --- | --- | --- |
| [`@subtubes/diagram-core`](diagram-core) | The model and the one way to change it. No UI. | `zod`, `zustand` (vanilla) |
| [`@subtubes/diagram-react`](diagram-react) | The React canvas for a controller, and a read-only viewer. | core, `react` |
| [`@subtubes/diagram-agent-tools`](diagram-agent-tools) | The agent's tools, from a controller. | core, `zod` |
| [`@subtubes/scenario-core`](scenario-core) | The scenario file format, running a scenario against a graph, checks, and the highlights of a run. No UI. | diagram-core, `zod` |
| [`@subtubes/scenario-react`](scenario-react) | The scenario player: run state, playback controls, trace and state panels. | scenario-core, `react` |

[`examples/host`](../examples/host) is an app that is not Subtubes, made only from these three: run it with `npm run example`.

## The ideas

- **One way to change a diagram.** Everything that edits it, a drag, a menu, an agent's tool call, is `controller.apply({ ops, summary, source })`. The operations are one validated vocabulary (`createNode`, `updateNode`, `createEdge`, ...). A batch is applied whole or not at all, and the answer carries the exact inverse.
- **The library only edits.** It keeps no history and has no approval step. A host that wants undo keeps the `inverse` of each change (`controller.onChange`) and sends it back with `controller.applyPatch`; a host that wants an approval step puts it around `apply`. The Subtubes app's journal and approval cards are exactly that (`src/changes/journal.ts`, `src/agentTools`).
- **Where a diagram lives is the host's choice.** A `DiagramRepository` (`load`, `save`, optional `subscribe`) is all the controller is bound to; `bindRepository` loads and autosaves, and stops instead of overwriting somebody else's save. Adapters: memory, `Storage`, REST.
- **One controller and one canvas state per diagram.** Two diagrams can be on a page. Nothing is global.
- **The canvas asks the host for what it does not know**: how to draw Markdown (a slot), what to say when it is empty (a prop), its colours (CSS variables, see `theme.css`).

## Rules that keep them reusable

`packages/boundary.test.ts` fails if a package imports anything of the app (`src`, `shared`, `server`), another package it is not built on, or a module it does not list as a peer dependency. The canvas's CSS variables are checked against the default theme (`diagram-react/src/theme.test.ts`) and against the app's own theme (`src/diagramTheme.test.ts`).

## In the Subtubes app

- `src/diagram/controller.ts`: the app's one controller. `src/diagram/instance.ts`: its canvas state. `src/stores/*Store.ts` are thin views of both, so code written against `useNodeStore` and the like keeps working.
- `src/changes/journal.ts`: the undo journal, a subscriber of `controller.onChange`; `undoChange` sends the stored inverse to `controller.applyPatch`.
- `src/agentTools/diagramTools.tsx`: the read tools are the package's (`createDiagramTools`); `applyChanges` adds the app's approval rule and rebasing.
- `src/diagram/slots.tsx`: the Markdown renderer the app gives the canvas. `src/diagram/nodeAnchor.tsx`: comments on nodes (the app's, not the canvas's).

## Known issues

See [diagram-react/docs/known-issues.md](diagram-react/docs/known-issues.md) (none open; the shared highlight types are recorded there as resolved).

## Not yet

- A second canvas implementation (React Flow, tldraw, Canvas2D) behind a formal renderer contract. The canvas already takes everything from a controller, slots and props, which is what such a contract would be written from.
- The report viewer (`DiagramViewer`) and the editable canvas share their parts (arrow heads, colours, geometry) but are two components.
- Collaboration. `expectedRevision` on `apply` and `subscribe` on a repository leave room for it.
