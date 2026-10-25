import { useSim } from './context'
import type { Outcome } from '@subtubes/scenario-core'

const OUTCOME_LABEL: Record<Outcome, string> = {
  success: 'Succeeded',
  failure: 'Failed',
  blocked: 'Blocked',
  stopped: 'Stopped',
}

function show(value: string | number | boolean) {
  return typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)
}

// What the run knows right now: its input, the state it has built up, and, at the end,
// how it turned out.
export function StatePanel() {
  const trace = useSim((s) => s.trace)
  const cursor = useSim((s) => s.cursor)
  const scenario = useSim((s) => s.scenarios.find((x) => x.id === s.activeId))
  // Before a run starts, show the input it will use.
  const pendingInput = useSim((s) => s.input)
  const input = trace?.input ?? pendingInput

  const step = trace?.steps[cursor]
  const labels = new Map(scenario?.inputs.map((f) => [f.name, f.label]))
  const changed = new Set(step?.changes.map((c) => c.key))
  const finished = step?.kind === 'end' && step.outcome

  return (
    <div className="sim-state">
      {finished && step.outcome && (
        <div className={`sim-outcome outcome-${step.outcome}`} role="status">
          <strong>{OUTCOME_LABEL[step.outcome]}</strong>
          <p>{step.title}</p>
        </div>
      )}

      <h3>Input</h3>
      {Object.keys(input).length > 0 ? (
        <dl>
          {Object.entries(input).map(([key, value]) => (
            <div key={key}>
              <dt>{labels.get(key) ?? key}</dt>
              <dd>{show(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="sim-muted">Nothing yet.</p>
      )}

      <h3>State</h3>
      {step && Object.keys(step.state).length > 0 ? (
        <dl>
          {Object.entries(step.state).map(([key, value]) => (
            <div key={key} className={changed.has(key) ? 'changed' : ''}>
              <dt>
                <code>{key}</code>
              </dt>
              <dd>{show(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="sim-muted">Empty.</p>
      )}
    </div>
  )
}
