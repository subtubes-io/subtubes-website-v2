import { edgeBetween } from './engine'
import type { GraphModel, Scenario, ScenarioIssue } from './types'

// Checks a scenario against the diagram it will run on. Errors mean part of it cannot
// run; warnings mean it runs but the diagram does not show that hop.
export function validateScenario(scenario: Scenario, graph: GraphModel): ScenarioIssue[] {
  const issues: ScenarioIssue[] = []
  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  for (const [stepId, step] of Object.entries(scenario.steps)) {
    if (!nodeIds.has(step.node)) {
      issues.push({ severity: 'error', message: `Step “${stepId}” refers to a node that is not in the diagram: ${step.node}` })
    }
    for (const call of step.calls ?? []) {
      if (nodeIds.has(step.node) && nodeIds.has(call.to) && !edgeBetween(graph, step.node, call.to)) {
        issues.push({ severity: 'warning', message: `No edge from ${step.node} to ${call.to} for the call in “${stepId}”.` })
      }
    }
    for (const next of step.next ?? []) {
      const target = next.to !== undefined ? scenario.steps[next.to] : undefined
      if (target && nodeIds.has(step.node) && nodeIds.has(target.node) && !edgeBetween(graph, step.node, target.node)) {
        issues.push({ severity: 'warning', message: `No edge from ${step.node} to ${target.node} for the branch in “${stepId}”.` })
      }
    }
  }
  return issues
}
