// Types for the simulation layer. Nothing here refers to the diagram, the chat or any
// other part of the app: a scenario is data, and it runs against a plain GraphModel.

export type Primitive = string | number | boolean
export type Values = Record<string, Primitive>

// The minimal view of a diagram the simulator needs. The host supplies it.
export interface GraphModel {
  nodes: { id: string; title: string }[]
  edges: { id: string; from: string; to: string; label: string }[]
}

// ---- Scenario definition (serializable) ----

export interface InputField {
  name: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  default: Primitive
  options?: string[]
  help?: string
  // Prefilled from the user's message when a scenario is proposed from the chat.
  fromChat?: boolean
}

export type CompareOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'truthy'

// Paths read `input.<name>` (what the user entered) or `state.<name>` (what the run has set).
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { path: string; op: CompareOp; value?: Primitive | Primitive[] }

export type Outcome = 'success' | 'failure' | 'blocked' | 'stopped'

export interface EndSpec {
  outcome: Exclude<Outcome, 'stopped'>
  message: string
}

export interface DeriveRule {
  contains: string[]
  value: Primitive
}

// "Fuzzy" interpretation, for example reading intent from free text. The mock does it with
// keyword rules; the same shape could later be filled in by a model.
export interface Derive {
  from: string
  rules: DeriveRule[]
  default: Primitive
}

export type Effect =
  | { set: string; value: Primitive }
  | { set: string; add: number }
  | { set: string; derive: Derive; ai?: boolean }

export interface Transition {
  // Either move to another step, or end the run here.
  to?: string
  end?: EndSpec
  when?: Condition
  label?: string
}

// A side trip to another node that returns immediately, such as a tool or a lookup.
export interface Call {
  to: string
  title: string
  detail?: string
  when?: Condition
}

export interface StepRule {
  // The diagram node this step happens at. Several steps may share a node.
  node: string
  title: string
  detail?: string
  effects?: Effect[]
  calls?: Call[]
  next?: Transition[]
  end?: EndSpec
}

export interface Preset {
  name: string
  values: Values
}

export interface Scenario {
  id: string
  title: string
  description: string
  // Words that make the chat propose this scenario.
  triggers?: string[]
  inputs: InputField[]
  presets?: Preset[]
  initialState?: Values
  // Id of the first step; transitions reference step ids.
  start: string
  steps: Record<string, StepRule>
}

export interface ScenarioFile {
  schemaVersion: 1
  scenarios: Scenario[]
}

// ---- A run ----

export type StepKind = 'enter' | 'call' | 'end'

export interface StateChange {
  key: string
  from?: Primitive
  to: Primitive
  ai?: boolean
}

export interface DecisionOption {
  label: string
  taken: boolean
}

export interface TraceStep {
  index: number
  kind: StepKind
  stepId: string
  nodeId: string
  nodeTitle: string
  // The diagram edge travelled to reach this step, when the diagram has one.
  edgeId?: string
  fromNodeId?: string
  title: string
  detail?: string
  changes: StateChange[]
  // Run state after this step.
  state: Values
  decision?: { options: DecisionOption[] }
  outcome?: Outcome
  warnings: string[]
}

export interface Trace {
  scenarioId: string
  scenarioTitle: string
  input: Values
  steps: TraceStep[]
  outcome: Outcome
  message: string
}

export interface ScenarioIssue {
  severity: 'error' | 'warning'
  message: string
}

// What a chat message carries when it proposes or reports a run.
export interface ScenarioAttachment {
  scenarioId: string
  // What the scenario and the engine were when this was made; see version.ts.
  scenarioVersion?: string
  engineVersion?: number
  input: Values
  result?: { outcome: Outcome; message: string; steps: number }
}
