import { useViewport } from './context'

interface ZoomControlsConfig {
  onZoom: (factor: number) => void
  onFit: () => void
}

const STEP = 1.2

export function ZoomControls({ config }: { config: ZoomControlsConfig }) {
  const { onZoom, onFit } = config
  const scale = useViewport((s) => s.scale)

  return (
    <div className="zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button className="dg-icon-btn" type="button" onClick={() => onZoom(STEP)} aria-label="Zoom in">
        +
      </button>
      <span className="zoom-pct">{Math.round(scale * 100)}%</span>
      <button className="dg-icon-btn" type="button" onClick={() => onZoom(1 / STEP)} aria-label="Zoom out">
        −
      </button>
      <button className="dg-btn" type="button" onClick={onFit}>
        Fit canvas
      </button>
    </div>
  )
}
