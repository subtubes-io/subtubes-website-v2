import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Trace, TraceStep } from '@subtubes/scenario-core'
import { useSim } from './context'

const KIND_LABEL = { enter: 'Step', call: 'Call', end: 'Result' } as const

function show(value: string | number | boolean | undefined) {
  return value === undefined ? '∅' : String(value)
}

function StepBody({ step }: { step: TraceStep }) {
  return (
    <>
      <div className="sim-step-head">
        <span className={`sim-kind kind-${step.kind}`}>{KIND_LABEL[step.kind]}</span>
        <strong>{step.nodeTitle}</strong>
      </div>
      <p className="sim-step-title">{step.title}</p>
      {step.detail && <p className="sim-step-detail">{step.detail}</p>}

      {step.changes.length > 0 && (
        <ul className="sim-changes" aria-label="State changes">
          {step.changes.map((c) => (
            <li key={c.key}>
              <code>{c.key}</code>
              <span>
                {c.from === undefined ? 'set to' : `${show(c.from)} →`} <b>{show(c.to)}</b>
              </span>
              {c.ai && <span className="chip ai" title="Interpreted by the AI">AI</span>}
            </li>
          ))}
        </ul>
      )}

      {step.decision && (
        <ul className="sim-decision" aria-label="Branches">
          {step.decision.options.map((o) => (
            <li key={o.label} className={o.taken ? 'taken' : ''}>
              {o.taken ? '✓' : '·'} {o.label}
            </li>
          ))}
        </ul>
      )}

      {step.warnings.map((w) => (
        <p key={w} className="sim-warning">
          {w}
        </p>
      ))}
    </>
  )
}

export interface TraceListProps {
  // Something beside each step, such as a button to comment on it.
  stepActions?: (step: TraceStep, trace: Trace) => ReactNode
  // Something under each step, such as the comments on it. Nothing is drawn when it returns null.
  stepExtras?: (step: TraceStep, trace: Trace) => ReactNode
  // What is said before a run starts.
  emptyHint?: ReactNode
}

// The steps played so far, newest at the bottom. Clicking a step goes back to it.
export function TraceList({ stepActions, stepExtras, emptyHint }: TraceListProps = {}) {
  const trace = useSim((s) => s.trace)
  const cursor = useSim((s) => s.cursor)
  const seek = useSim((s) => s.seek)
  const listRef = useRef<HTMLOListElement>(null)

  // Keep the newest step in view while playing.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [cursor, trace])

  if (!trace) {
    return (
      <p className="sim-empty">
        {emptyHint ?? (
          <>
            Press <strong>Play</strong> to run this scenario with its default input. The path lights up on the diagram as it plays, and every step is listed here.
          </>
        )}
      </p>
    )
  }

  return (
    <ol className="sim-steps" ref={listRef} aria-label="Trace">
      {trace.steps.slice(0, cursor + 1).map((step) => {
        const active = step.index === cursor
        const extras = stepExtras?.(step, trace) ?? null
        return (
          <li key={step.index} className={`sim-step${active ? ' active' : ''}${step.outcome ? ` outcome-${step.outcome}` : ''}`}>
            <button className="sim-step-main" type="button" onClick={() => seek(step.index)} aria-current={active}>
              <span className="sim-index">{step.index + 1}</span>
              <span className="sim-step-content">
                <StepBody step={step} />
              </span>
            </button>
            {stepActions?.(step, trace)}
            {extras && <div className="sim-inline">{extras}</div>}
          </li>
        )
      })}
    </ol>
  )
}
