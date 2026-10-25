// The scenario engine, with no UI and nothing of the app: the shape of a scenario and its file format, a run of a
// scenario against a graph of nodes and edges, the checks that tell whether a scenario fits a graph, and the
// highlights a run lights up on a diagram.
export { defaultInput, edgeBetween, runScenario } from './engine'
export { checkNewScenario } from './check'
export type { NewScenarioCheck } from './check'
export { validateScenario } from './validate'
export { highlightsAt } from './highlights'
export type { EdgeHighlight, Highlights, NodeHighlight } from './highlights'
export { conditionSchema, scenarioSchema } from './scenarioSchema'
export type { ScenarioCondition, ScenarioDraft } from './scenarioSchema'
export { SCENARIO_SCHEMA_VERSION, parseScenarioFile, readScenarioFile, scenarioFileFormat, scenarioFileSchema, scenarioFileV1Schema } from './schema'
export { ENGINE_VERSION, scenarioVersion } from './version'
export type * from './types'
