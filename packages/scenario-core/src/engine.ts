import { describeCondition, evaluate, interpolate, resolvePath } from './conditions'
import type { Scope } from './conditions'
import type {
  Effect,
  EndSpec,
  GraphModel,
  Outcome,
  Scenario,
  StateChange,
  StepRule,
  Trace,
  TraceStep,
  Transition,
  Values,
} from './types'

// Guards against scenarios that loop forever.
const MAX_STEPS = 60

export function edgeBetween(graph: GraphModel, from: string, to: string) {
  return graph.edges.find((e) => e.from === from && e.to === to)
}

function applyEffects(effects: Effect[], input: Values, state: Values): StateChange[] {
  const changes: StateChange[] = []

  for (const effect of effects) {
    const scope: Scope = { input, state }
    let value: StateChange['to']
    let ai = false

    if ('derive' in effect) {
      const source = String(resolvePath(scope, effect.derive.from) ?? '').toLowerCase()
      const rule = effect.derive.rules.find((r) => r.contains.some((word) => source.includes(word.toLowerCase())))
      value = rule ? rule.value : effect.derive.default
      ai = effect.ai === true
    } else if ('add' in effect) {
      value = Number(state[effect.set] ?? 0) + effect.add
    } else {
      value = typeof effect.value === 'string' ? interpolate(effect.value, scope) : effect.value
    }

    if (state[effect.set] !== value) {
      changes.push({ key: effect.set, from: state[effect.set], to: value, ai: ai || undefined })
      state[effect.set] = value
    }
  }
  return changes
}

// Runs a scenario against a graph for one input and returns the whole trace up front.
// Pure and deterministic: playing it back (pause, step, rewind) is just moving a cursor.
export function runScenario(graph: GraphModel, scenario: Scenario, input: Values): Trace {
  const titles = new Map(graph.nodes.map((n) => [n.id, n.title]))
  const nodeTitle = (id: string) => titles.get(id) ?? id
  const state: Values = { ...scenario.initialState }
  const steps: TraceStep[] = []
  let outcome: Outcome = 'stopped'
  let message = ''

  const scope = (): Scope => ({ input, state })
  const push = (step: Omit<TraceStep, 'index' | 'state' | 'nodeTitle'>) =>
    steps.push({ ...step, index: steps.length, nodeTitle: nodeTitle(step.nodeId), state: { ...state } })

  const end = (stepId: string, nodeId: string, result: EndSpec | { outcome: 'stopped'; message: string }) => {
    outcome = result.outcome
    message = interpolate(result.message, scope())
    push({ kind: 'end', stepId, nodeId, title: message, outcome, changes: [], warnings: [] })
  }

  let current: string | undefined = scenario.start
  let incoming: { edgeId?: string; from?: string } = {}

  while (current !== undefined) {
    const rule: StepRule | undefined = scenario.steps[current]
    if (!rule) {
      outcome = 'stopped'
      message = `Step “${current}” is not defined.`
      break
    }
    if (steps.length >= MAX_STEPS) {
      end(current, rule.node, { outcome: 'stopped', message: `Stopped after ${MAX_STEPS} steps; the scenario may be looping.` })
      break
    }

    const changes = applyEffects(rule.effects ?? [], input, state)
    const warnings: string[] = []
    if (incoming.from && !incoming.edgeId) {
      warnings.push(`The diagram has no edge from “${nodeTitle(incoming.from)}” to “${nodeTitle(rule.node)}”.`)
    }
    push({
      kind: 'enter',
      stepId: current,
      nodeId: rule.node,
      edgeId: incoming.edgeId,
      fromNodeId: incoming.from,
      title: interpolate(rule.title, scope()),
      detail: rule.detail ? interpolate(rule.detail, scope()) : undefined,
      changes,
      warnings,
    })
    const enterIndex = steps.length - 1

    for (const call of rule.calls ?? []) {
      if (call.when && !evaluate(call.when, scope())) continue
      const edge = edgeBetween(graph, rule.node, call.to)
      push({
        kind: 'call',
        stepId: current,
        nodeId: call.to,
        edgeId: edge?.id,
        fromNodeId: rule.node,
        title: interpolate(call.title, scope()),
        detail: call.detail ? interpolate(call.detail, scope()) : undefined,
        changes: [],
        warnings: edge ? [] : [`The diagram has no edge from “${nodeTitle(rule.node)}” to “${nodeTitle(call.to)}”.`],
      })
    }

    if (rule.end) {
      end(current, rule.node, rule.end)
      break
    }

    const next: Transition[] = rule.next ?? []
    if (next.length === 0) {
      end(current, rule.node, { outcome: 'success', message: 'The flow finished.' })
      break
    }

    const taken = next.findIndex((t) => !t.when || evaluate(t.when, scope()))
    if (next.length > 1) {
      steps[enterIndex].decision = {
        options: next.map((t, i) => ({
          label: t.label ?? (t.when ? describeCondition(t.when) : 'otherwise'),
          taken: i === taken,
        })),
      }
    }
    if (taken < 0) {
      end(current, rule.node, { outcome: 'stopped', message: 'No branch matched here, so the run stopped.' })
      break
    }

    const transition: Transition = next[taken]
    if (transition.end) {
      end(current, rule.node, transition.end)
      break
    }

    const target = transition.to !== undefined ? scenario.steps[transition.to] : undefined
    const edge = target ? edgeBetween(graph, rule.node, target.node) : undefined
    incoming = { edgeId: edge?.id, from: rule.node }
    current = transition.to
  }

  return { scenarioId: scenario.id, scenarioTitle: scenario.title, input, steps, outcome, message }
}

export function defaultInput(scenario: Scenario): Values {
  return Object.fromEntries(scenario.inputs.map((f) => [f.name, f.default]))
}
