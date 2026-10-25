# @subtubes/scenario-react

The scenario player for React: the state of a run, playback controls, the trace and state panels, and a player that puts them together. No comments and nothing of the app. Peer dependencies: `react`, `zustand`, `@subtubes/scenario-core`.

```tsx
import { createSimulationStore, ScenarioPlayer, SimulationContext } from '@subtubes/scenario-react'
import '@subtubes/scenario-react/theme.css'     // default colours; skip it if the host defines the variables itself
import '@subtubes/scenario-react/scenario.css'
import { highlightsAt } from '@subtubes/scenario-core'

const store = createSimulationStore(() => ({ nodes, edges }))   // where the diagram comes from, asked at every run
store.getState().registerScenarios(scenarios)
store.getState().openPanel()

<SimulationContext.Provider value={store}>
  <ScenarioPlayer />
</SimulationContext.Provider>

// Light the path up on a diagram (for example a DiagramViewer's highlights) as the run plays:
store.subscribe((s) => s.trace && setHighlights(highlightsAt(s.trace, s.cursor)))
```

- **One store per player.** Two players on a page do not share a diagram, scenarios or timer. A host with a single player can call `setDefaultSimulationStore(store)` once instead of using a provider.
- **Slots** on `ScenarioPlayer`'s `config`: `trace` (your own list of steps), `footer`, `onDelete(scenario)` (shows a delete button; ask for confirmation and call `removeScenario` yourself), `height` and `resizer`. `TraceList` takes `stepActions`, `stepExtras` and `emptyHint`, which is how the Subtubes app adds comments to each step.
- **Pieces on their own**: `PlaybackControls`, `StatePanel` and `TraceList` can be placed anywhere inside a provider.
- **Theme**: CSS variables only (`theme.css` lists them). The few shared controls it uses (`.icon-btn`, `.chip`) are declared at no specificity, so a host's own styles win.

In the Subtubes app, `src/simulation/store.ts` makes the open design's store and `components/ScenarioPlayer.tsx` / `TraceList.tsx` add the app's comments, review bar and confirmed delete.
