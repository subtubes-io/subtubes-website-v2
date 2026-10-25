import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EDGE_HIGHLIGHTS, NODE_HIGHLIGHTS } from '@subtubes/diagram-core'

const css = readFileSync(new URL('./diagram.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

// Set by the canvas itself, inline or in its own rules.
const OWN = new Set(['--layer', '--edge-color', '--inv'])

const used = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !OWN.has(v))
const defined = (text: string) => new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]))

describe('the canvas theme', () => {
  it('has a default for every variable the canvas reads, in light and dark', () => {
    const shared = theme.slice(theme.indexOf(':root {'), theme.indexOf(':root,'))
    const light = shared + theme.slice(theme.indexOf(':root,'), theme.indexOf(":root[data-theme='dark']"))
    const dark = shared + theme.slice(theme.indexOf(":root[data-theme='dark']"), theme.indexOf('@media'))
    expect(used.length).toBeGreaterThan(10)
    for (const variable of used) {
      expect(defined(light).has(variable), `${variable} in light`).toBe(true)
      expect(defined(dark).has(variable), `${variable} in dark`).toBe(true)
    }
  })

  it('has every preset colour for a node, group or edge, in both', () => {
    for (const preset of ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray']) {
      expect(theme.match(new RegExp(`--c-${preset}:`, 'g'))?.length, preset).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('highlights', () => {
  it('have a style for every kind the core declares, on nodes and on edges', () => {
    for (const state of NODE_HIGHLIGHTS) expect(css, `.node.hl-${state}`).toMatch(new RegExp(`\\.node\\.hl-${state}\\b`))
    for (const state of EDGE_HIGHLIGHTS) expect(css, `.edge.hl-${state}`).toMatch(new RegExp(`\\.edge\\.hl-${state}\\b`))
  })
})
