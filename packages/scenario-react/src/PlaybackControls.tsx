import { useSim, useSimStore } from './context'

const SPEEDS = [
  { label: '0.5×', ms: 2200 },
  { label: '1×', ms: 1100 },
  { label: '2×', ms: 550 },
  { label: '4×', ms: 275 },
]

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function PlaybackControls() {
  const trace = useSim((s) => s.trace)
  const cursor = useSim((s) => s.cursor)
  const status = useSim((s) => s.status)
  const stepMs = useSim((s) => s.stepMs)
  const { play, pause, stepForward, stepBack, seek, reset, setStepMs } = useSimStore().getState()

  const total = trace?.steps.length ?? 0
  const playing = status === 'playing'

  return (
    <div className="sim-controls">
      <div className="sim-buttons" role="group" aria-label="Playback">
        <button className="icon-btn" type="button" onClick={reset} disabled={!trace} aria-label="Back to the start" title="Back to the start">
          <Icon d="M6 5v14M19 5 9 12l10 7z" />
        </button>
        <button className="icon-btn" type="button" onClick={stepBack} disabled={!trace || cursor <= 0} aria-label="Previous step" title="Previous step">
          <Icon d="m15 18-6-6 6-6" />
        </button>
        <button
          className="icon-btn sim-play"
          type="button"
          onClick={playing ? pause : play}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Icon d="M8 5v14M16 5v14" /> : <Icon d="M7 4v16l13-8z" />}
        </button>
        <button className="icon-btn" type="button" onClick={stepForward} disabled={trace !== null && cursor >= total - 1} aria-label="Next step" title="Next step">
          <Icon d="m9 18 6-6-6-6" />
        </button>
      </div>

      <input
        className="sim-progress"
        type="range"
        min={0}
        max={Math.max(total - 1, 0)}
        value={Math.max(cursor, 0)}
        disabled={!trace}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Progress"
      />
      <span className="sim-count">{trace ? `Step ${cursor + 1} of ${total}` : 'Not started'}</span>

      <select
        className="sim-speed"
        value={stepMs}
        onChange={(e) => setStepMs(Number(e.target.value))}
        aria-label="Speed"
      >
        {SPEEDS.map((s) => (
          <option key={s.ms} value={s.ms}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}
