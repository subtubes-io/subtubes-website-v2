import { defaultInput, runScenario } from './engine'
import { validateScenario } from './validate'
import type { GraphModel, Scenario, ScenarioIssue } from './types'

export type NewScenarioCheck =
  | { ok: true; issues: ScenarioIssue[]; preview: { outcome: 'success' | 'failure' | 'blocked' | 'stopped'; message: string; steps: number } }
  | { ok: false; error: 'duplicate-id' | 'unknown-nodes' | 'invalid'; message: string; issues?: ScenarioIssue[] }

const MAX_LISTED_NODES = 40

// Everything that has to hold before a scenario written by the assistant is saved into a design. The shape (zod)
// has already been checked; this is what the shape cannot say: that it fits this diagram, that its inputs make
// sense, and that it runs. Errors refuse it, with a message the assistant can act on. Warnings come back with it.
export function checkNewScenario(scenario: Scenario, graph: GraphModel, existingIds: string[]): NewScenarioCheck {
  if (existingIds.includes(scenario.id)) {
    return {
      ok: false,
      error: 'duplicate-id',
      message: `This design already has a scenario with the id "${scenario.id}". Use a different id. Existing ids: ${existingIds.join(', ')}.`,
    }
  }

  const inputProblems = checkInputs(scenario)
  if (inputProblems.length > 0) {
    return { ok: false, error: 'invalid', message: `The scenario's inputs are not usable: ${inputProblems.join(' ')}` }
  }

  const unknown = unknownNodes(scenario, graph)
  if (unknown.length > 0) {
    const byTitle = new Map(graph.nodes.map((n) => [n.title.trim().toLowerCase(), n.id]))
    const lines = unknown.map((ref) => {
      const guess = byTitle.get(ref.trim().toLowerCase())
      return guess ? `"${ref}" is a title, not an id; use "${guess}".` : `"${ref}" is not a node in the diagram.`
    })
    const known = graph.nodes.slice(0, MAX_LISTED_NODES).map((n) => `${n.id} (${n.title})`).join(', ')
    const more = graph.nodes.length > MAX_LISTED_NODES ? `, and ${graph.nodes.length - MAX_LISTED_NODES} more (call getDiagram)` : ''
    return {
      ok: false,
      error: 'unknown-nodes',
      message: `Steps must happen at nodes that exist. ${lines.join(' ')} Nodes in the diagram: ${known || 'none'}${more}.`,
    }
  }

  const trace = runScenario(graph, scenario, defaultInput(scenario))
  if (trace.outcome === 'stopped') {
    return { ok: false, error: 'invalid', message: `A trial run with the default inputs did not finish: ${trace.message} Make sure every step either ends or has a branch that always applies (a last one with no "when").` }
  }

  const issues = [...validateScenario(scenario, graph).filter((i) => i.severity === 'warning'), ...lint(scenario)]
  return { ok: true, issues, preview: { outcome: trace.outcome, message: trace.message, steps: trace.steps.length } }
}

function checkInputs(scenario: Scenario): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const field of scenario.inputs) {
    if (seen.has(field.name)) problems.push(`Two inputs are called "${field.name}".`)
    seen.add(field.name)
    const kind = typeof field.default
    if (field.type === 'number' && kind !== 'number') problems.push(`Input "${field.name}" is a number, so its default must be a number.`)
    if (field.type === 'boolean' && kind !== 'boolean') problems.push(`Input "${field.name}" is a boolean, so its default must be true or false.`)
    if (field.type === 'text' && kind !== 'string') problems.push(`Input "${field.name}" is text, so its default must be a string.`)
    if (field.type === 'select') {
      if (!field.options || field.options.length === 0) problems.push(`Input "${field.name}" is a select, so it needs "options".`)
      else if (!field.options.includes(String(field.default))) problems.push(`The default of "${field.name}" must be one of its options.`)
    }
  }
  return problems
}

// Node references that are not in the diagram, in first-seen order.
function unknownNodes(scenario: Scenario, graph: GraphModel): string[] {
  const ids = new Set(graph.nodes.map((n) => n.id))
  const unknown: string[] = []
  const check = (ref: string) => {
    if (!ids.has(ref) && !unknown.includes(ref)) unknown.push(ref)
  }
  for (const step of Object.values(scenario.steps)) {
    check(step.node)
    for (const call of step.calls ?? []) check(call.to)
  }
  return unknown
}

// Things that still run but are probably mistakes.
function lint(scenario: Scenario): ScenarioIssue[] {
  const issues: ScenarioIssue[] = []
  const warn = (message: string) => issues.push({ severity: 'warning', message })

  const inputNames = new Set(scenario.inputs.map((f) => f.name))
  const stateNames = new Set(Object.keys(scenario.initialState ?? {}))
  for (const step of Object.values(scenario.steps)) for (const effect of step.effects ?? []) stateNames.add(effect.set)

  const checkRef = (ref: string, where: string) => {
    const [root, ...rest] = ref.split('.')
    const name = rest.join('.')
    if (root === 'input' && !inputNames.has(name)) warn(`${where} reads input.${name}, but the scenario has no input called "${name}".`)
    if (root === 'state' && !stateNames.has(name)) warn(`${where} reads state.${name}, but no step sets it and it is not in initialState.`)
  }

  const conditionPaths = (condition: unknown): string[] => {
    if (typeof condition !== 'object' || condition === null) return []
    const c = condition as Record<string, unknown>
    if (Array.isArray(c.all)) return c.all.flatMap(conditionPaths)
    if (Array.isArray(c.any)) return c.any.flatMap(conditionPaths)
    if ('not' in c) return conditionPaths(c.not)
    return typeof c.path === 'string' ? [c.path] : []
  }

  for (const [stepId, step] of Object.entries(scenario.steps)) {
    const where = `Step “${stepId}”`
    for (const next of step.next ?? []) for (const path of conditionPaths(next.when)) checkRef(path, where)
    for (const call of step.calls ?? []) for (const path of conditionPaths(call.when)) checkRef(path, where)
    for (const effect of step.effects ?? []) if ('derive' in effect) checkRef(effect.derive.from, where)
  }
  for (const text of strings(scenario)) {
    for (const match of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) checkRef(match[1], 'The text')
  }

  for (const preset of scenario.presets ?? []) {
    for (const key of Object.keys(preset.values)) {
      if (!inputNames.has(key)) warn(`Preset “${preset.name}” sets "${key}", which is not an input.`)
    }
  }

  const reached = new Set<string>()
  const visit = (id: string) => {
    if (reached.has(id) || !scenario.steps[id]) return
    reached.add(id)
    for (const next of scenario.steps[id].next ?? []) if (next.to !== undefined) visit(next.to)
  }
  visit(scenario.start)
  for (const id of Object.keys(scenario.steps)) if (!reached.has(id)) warn(`Step “${id}” can never be reached from the start.`)

  return dedupe(issues)
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings)
  return []
}

function dedupe(issues: ScenarioIssue[]): ScenarioIssue[] {
  const seen = new Set<string>()
  return issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)))
}
