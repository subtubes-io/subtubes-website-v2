import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { diagramBounds, edgeGeometry, labelWidth } from '@subtubes/diagram-core'
import type { DiagramFile } from '@subtubes/diagram-core'
import { ArrowHeads } from './ArrowHeads'
import { arrowId, edgeColor, edgeStyle, layerStyle } from './colors'
import type { Highlights } from '@subtubes/diagram-core'

const MIN_SCALE = 0.1
const MAX_SCALE = 2.5
const GRID = 24

interface View {
  x: number
  y: number
  scale: number
}

function fitView(width: number, height: number, bounds: { w: number; h: number }): View {
  if (bounds.w === 0 || bounds.h === 0 || width === 0 || height === 0) return { x: 0, y: 0, scale: 1 }
  const margin = 32
  const scale = Math.min(Math.max(Math.min((width - margin * 2) / bounds.w, (height - margin * 2) / bounds.h), MIN_SCALE), 1)
  return { scale, x: (width - bounds.w * scale) / 2, y: (height - bounds.h * scale) / 2 }
}

export interface DiagramViewerConfig {
  diagram: DiagramFile
  highlights?: Highlights
  // Fade what the current step does not involve.
  focus?: boolean
  // Draws a node's content (Markdown). Without it the text is shown as it is.
  renderMarkdown?: (source: string) => ReactNode
}

// A diagram drawn from a file, with nothing to select, move or edit and no controller: a saved copy (a report's), a preview, a page that only
// shows. It can be panned and zoomed, and lights up as a scenario plays.
export function DiagramViewer({ config }: { config: DiagramViewerConfig }) {
  const { diagram, highlights, focus = false, renderMarkdown } = config
  const arrow = `snap-arrow-${useId().replace(/:/g, '')}`
  const ref = useRef<HTMLElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const [panning, setPanning] = useState(false)

  const bounds = useMemo(() => diagramBounds(diagram.groups, diagram.nodes), [diagram])
  const nodesById = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram])

  const fit = useCallback(() => {
    const el = ref.current
    if (el) setView(fitView(el.clientWidth, el.clientHeight, bounds))
  }, [bounds])

  // Fitted when shown and whenever the box changes size, until the person pans or zooms.
  const touched = useRef(false)
  useEffect(() => {
    touched.current = false
    fit()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!touched.current) fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit])

  const zoomAround = (factor: number, px: number, py: number) => {
    touched.current = true
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, MIN_SCALE), MAX_SCALE)
      const k = scale / v.scale
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }

  const zoomCenter = (factor: number) => {
    const el = ref.current
    if (el) zoomAround(factor, el.clientWidth / 2, el.clientHeight / 2)
  }

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const edges = diagram.edges.flatMap((edge) => {
    const a = nodesById.get(edge.from)
    const b = nodesById.get(edge.to)
    return a && b ? [{ edge, geometry: edgeGeometry(a, b) }] : []
  })

  const stop = () => {
    drag.current = null
    setPanning(false)
  }

  return (
    <section
      ref={ref}
      className={`canvas snapshot-canvas${panning ? ' dragging' : ''}`}
      aria-label="Diagram snapshot"
      style={{ backgroundSize: `${GRID * view.scale}px ${GRID * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        touched.current = true
        setPanning(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div className={focus ? 'world focus' : 'world'} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {diagram.groups.map((g) => (
          <div key={g.id} className={g.lane ? 'group swimlane' : 'group'} style={{ left: g.x, top: g.y, width: g.w, height: g.h, ...layerStyle(g.color) }}>
            <div className="group-bar">
              <span className="group-title">{g.title}</span>
              {g.lane && <span className="lane-description">{g.lane.body}</span>}
            </div>
          </div>
        ))}

        <svg className="edges" width={bounds.w} height={bounds.h} aria-hidden="true">
          <defs>
            <ArrowHeads id={arrow} colors={edges.map(({ edge }) => edge.color)} />
          </defs>
          {edges.map(({ edge, geometry }) => {
            const hl = highlights?.edges[edge.id]
            const className = ['edge', edge.dashed ? 'dashed' : '', edge.optional ? 'optional' : '', edgeColor(edge.color) ? 'colored' : '', hl ? `hl-${hl}` : ''].filter(Boolean).join(' ')
            return <path key={edge.id} d={geometry.d} className={className} style={edgeStyle(edge.color)} markerEnd={`url(#${arrowId(arrow, edge.color)})`} />
          })}
        </svg>

        {diagram.nodes.map((node) => {
          const hl = highlights?.nodes[node.id]
          return (
            <article key={node.id} data-node-id={node.id} className={`node${hl ? ` hl-${hl}` : ''}`} style={{ left: node.x, top: node.y, width: node.w, height: node.h, ...layerStyle(node.color) }}>
              <h2>{node.title}</h2>
              {renderMarkdown ? renderMarkdown(node.body) : <div className="dg-plain">{node.body}</div>}
            </article>
          )
        })}

        <svg className="labels" width={bounds.w} height={bounds.h} aria-hidden="true">
          {edges.map(({ edge, geometry }) => {
            if (!edge.label) return null
            const hl = highlights?.edges[edge.id]
            const width = labelWidth(edge)
            return (
              <g key={edge.id} className={['edge-label', hl ? `hl-${hl}` : ''].filter(Boolean).join(' ')} transform={`translate(${geometry.lx}, ${geometry.ly})`}>
                <rect x={-width / 2} y={-9} width={width} height={18} rx={4} className="label-bg" />
                <text textAnchor="middle" dy="3.5" className="label-text">
                  {edge.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="dg-icon-btn" type="button" onClick={() => zoomCenter(1.2)} aria-label="Zoom in snapshot">
          +
        </button>
        <span className="zoom-pct">{Math.round(view.scale * 100)}%</span>
        <button className="dg-icon-btn" type="button" onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out snapshot">
          −
        </button>
        <button
          className="dg-btn"
          type="button"
          onClick={() => {
            touched.current = false
            fit()
          }}
        >
          Fit
        </button>
      </div>
    </section>
  )
}
