# @subtubes/scenario-core

The scenario engine, without UI. Peer dependencies: `zod`, `@subtubes/diagram-core`.

```ts
import { defaultInput, readScenarioFile, runScenario } from '@subtubes/scenario-core'

const file = readScenarioFile(json)            // { ok, value: { scenarios } } or a typed error
const graph = { nodes: [{ id: 'a', title: 'Web' }], edges: [{ id: 'e', from: 'a', to: 'b' }] }
const scenario = file.ok ? file.value.scenarios[0] : undefined
const trace = scenario && runScenario(graph, scenario, defaultInput(scenario))   // steps, outcome, message
```

- `runScenario(graph, scenario, input)` is pure: the same graph, scenario and input give the same trace.
- `validateScenario` / `checkNewScenario` report the steps that point at nodes or edges the graph does not have.
- `highlightsAt(trace, cursor)` gives what to light up on a diagram at a step (the types are `diagram-core`'s).
- `scenarioSchema` is the one definition used by the file format and by the createScenario tool.
