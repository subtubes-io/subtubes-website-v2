import type { CSSProperties } from 'react'
import { arrowId, colorCss, colorKey, colorLabel, COLOR_PRESETS, isPreset } from '@subtubes/diagram-core'

export { arrowId, colorCss, colorKey, colorLabel, COLOR_PRESETS, isPreset }

// A node or group takes its colour from --layer, so a chosen colour replaces the default one.
export function layerStyle(color: string | undefined): CSSProperties {
  const css = colorCss(color)
  return css ? ({ '--layer': css } as CSSProperties) : {}
}

// A line takes its colour from --edge-color (the 'colored' class puts it on the stroke).
export const edgeColor = colorCss
export function edgeStyle(color: string | undefined): CSSProperties | undefined {
  const css = colorCss(color)
  return css ? ({ '--edge-color': css } as CSSProperties) : undefined
}

// The id the arrow heads of one diagram's lines start from.
export const arrowBase = (uid: string) => `${uid}-arrow`
