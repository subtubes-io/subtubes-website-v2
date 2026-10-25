import type { ReactNode } from 'react'
import type { Scenario } from '@subtubes/scenario-core'
import { PlaybackControls } from './PlaybackControls'
import { StatePanel } from './StatePanel'
import { TraceList } from './TraceList'
import { useSim, useSimStore } from './context'

export interface ScenarioPlayerConfig {
  // How tall the player is, and the handle that resizes it (the player does not know about layout).
  height?: number
  resizer?: ReactNode
  // The list of steps; the plain one when not given.
  trace?: ReactNode
  // Under the steps, for example a bar of review comments.
  footer?: ReactNode
  // Shows a delete button for the open scenario and calls this when it is pressed. The host asks for confirmation and
  // removes the scenario (`removeScenario` on the store); without it there is no button.
  onDelete?: (scenario: Scenario) => void
}

const Close = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

// The scenario player: pick a scenario and watch it play out. It reads and writes only the simulation store; what lights
// up on the diagram, and anything about comments or deleting, is up to the host.
export function ScenarioPlayer({ config = {} }: { config?: ScenarioPlayerConfig }) {
  const { height, resizer, trace, footer, onDelete } = config
  const store = useSimStore()
  const open = useSim((s) => s.panelOpen)
  const scenarios = useSim((s) => s.scenarios)
  const activeId = useSim((s) => s.activeId)
  const issues = useSim((s) => s.issues)
  const focusMode = useSim((s) => s.focusMode)
  const issuesHidden = useSim((s) => s.issuesHidden)
  const { setFocusMode, selectScenario, closePanel, setIssuesHidden } = store.getState()

  if (!open) return null

  const scenario = scenarios.find((s) => s.id === activeId)

  return (
    <section className="sim-player" aria-label="Scenario player" style={height === undefined ? undefined : { height }}>
      {resizer}
      <header className="sim-head">
        <h2>Scenario player</h2>
        {scenarios.length > 0 ? (
          <select value={activeId ?? ''} onChange={(e) => selectScenario(e.target.value)} aria-label="Scenario">
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        ) : null}
        {scenario && onDelete && (
          <button className="icon-btn small" type="button" onClick={() => onDelete(scenario)} aria-label="Delete scenario" title="Delete this scenario from the design">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
        <p className="sim-desc">{scenarios.length === 0 ? 'No scenarios.' : scenario?.description}</p>
        {issues.length > 0 && issuesHidden && (
          <button className="sim-problems-chip" type="button" onClick={() => setIssuesHidden(false)} title="Show the problems with this scenario">
            {issues.length} problem{issues.length === 1 ? '' : 's'}
          </button>
        )}
        <label className="sim-focus" title="Fade the parts of the diagram this step does not involve">
          <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} />
          Focus
        </label>
        <button className="icon-btn" type="button" onClick={closePanel} aria-label="Close scenario player">
          <Close size={16} />
        </button>
      </header>

      {issues.length > 0 && !issuesHidden && (
        <div className="sim-problems">
          <header>
            <strong>
              {issues.length} problem{issues.length === 1 ? '' : 's'} with this scenario
            </strong>
            <button className="icon-btn small" type="button" onClick={() => setIssuesHidden(true)} aria-label="Close problems">
              <Close size={14} />
            </button>
          </header>
          <ul className="sim-issues" aria-label="Scenario problems">
            {issues.map((issue, i) => (
              <li key={i} className={issue.severity}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scenarios.length === 0 ? (
        <p className="sim-empty" role="status">
          Nothing to play.
        </p>
      ) : (
        <div className="sim-grid">
          <div className="sim-trace">
            <PlaybackControls />
            {trace ?? <TraceList />}
            {footer}
          </div>
          <aside className="sim-side" aria-label="State">
            <StatePanel />
          </aside>
        </div>
      )}
    </section>
  )
}
