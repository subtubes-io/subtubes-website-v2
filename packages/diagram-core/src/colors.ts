import { z } from 'zod'

// The colours a node, group or edge can be given. A colour is a preset name, which follows the theme (see --c-* in theme.css of
// @subtubes/diagram-react), or a fixed #rrggbb. The website checks the same two forms (subtubes-remote lib/pull-request-reports/schema.ts).
export const COLOR_PRESETS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'] as const
export type ColorPreset = (typeof COLOR_PRESETS)[number]

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const colorSchema = z.union([z.enum(COLOR_PRESETS), z.string().regex(HEX_COLOR)])

export const isPreset = (color: string): color is ColorPreset => (COLOR_PRESETS as readonly string[]).includes(color)

// What CSS draws for a stored colour. Anything that is neither a preset nor a hex gives nothing, so a bad value in a file
// can never reach a style attribute.
export function colorCss(color: string | undefined): string | undefined {
  if (color === undefined) return undefined
  if (isPreset(color)) return `var(--c-${color})`
  return HEX_COLOR.test(color) ? color.toLowerCase() : undefined
}

// One arrow head is drawn for each colour in use, since a marker cannot take the colour of the line that points at it.
export const colorKey = (color: string) => (isPreset(color) ? color : color.slice(1).toLowerCase())
export const arrowId = (base: string, color: string | undefined) => (colorCss(color) && color ? `${base}-${colorKey(color)}` : base)

export const colorLabel = (color: string) => (isPreset(color) ? color[0].toUpperCase() + color.slice(1) : color.toLowerCase())
