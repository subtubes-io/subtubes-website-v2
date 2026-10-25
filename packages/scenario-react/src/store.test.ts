import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphModel, Scenario } from '@subtubes/scenario-core'
import { createSimulationStore } from './store'

const graph: GraphModel = {
  nodes: [
    { id: 'a', title: 'Web' },
    { id: 'b', title: 'API' },
  ],
  edges: [{ id: 'e', from: 'a', to: 'b', label: '' }],
}

const scenario: Scenario = {
  id: 'hello',
  title: 'Hello',
  description: 'A request reaches the API.',
  inputs: [{ name: 'amount', label: 'Amount', type: 'number', default: 5 }],
  start: 'ask',
  steps: {
    ask: { node: 'a', title: 'Ask for {{input.amount}}', next: [{ to: 'answer' }] },
    answer: { node: 'b', title: 'Answer', end: { outcome: 'success', message: 'Done.' } },
  },
}

afterEach(() => vi.useRealTimers())

describe('a player store, with no app', () => {
  it('runs a scenario against the graph it was given and steps through it', () => {
    const store = createSimulationStore(() => graph)
    store.getState().registerScenarios([scenario])
    expect(store.getState().activeId).toBe('hello')
    expect(store.getState().input).toEqual({ amount: 5 })

    store.getState().run({ autoplay: false })
    const { trace } = store.getState()
    expect(trace?.outcome).toBe('success')
    expect(store.getState().cursor).toBe(0)
    const last = (trace?.steps.length ?? 0) - 1
    expect(last).toBeGreaterThan(0)
    store.getState().stepForward()
    expect(store.getState().cursor).toBe(1)
    for (let i = 1; i < last; i++) store.getState().stepForward()
    expect(store.getState().cursor).toBe(last)
    expect(store.getState().status).toBe('finished')
  })

  it('plays on a timer until the run ends', () => {
    vi.useFakeTimers()
    const store = createSimulationStore(() => graph)
    store.getState().registerScenarios([scenario])
    store.getState().setStepMs(10)
    store.getState().run()
    expect(store.getState().status).toBe('playing')
    vi.advanceTimersByTime(50)
    expect(store.getState().status).toBe('finished')
  })

  it('reports a step at a node the diagram does not have', () => {
    const store = createSimulationStore(() => ({ nodes: [graph.nodes[0]], edges: [] }))
    store.getState().registerScenarios([scenario])
    expect(store.getState().issues.length).toBeGreaterThan(0)
  })

  it('keeps one player apart from another', () => {
    const one = createSimulationStore(() => graph)
    const two = createSimulationStore(() => graph)
    one.getState().registerScenarios([scenario])
    expect(two.getState().scenarios).toEqual([])
  })
})

describe('the player theme', () => {
  const css = readFileSync(new URL('./scenario.css', import.meta.url), 'utf8')
  const theme = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')
  const own = new Set(['--sim-active'])
  const used = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !own.has(v))

  it('has a default for every variable the player reads', () => {
    const defined = new Set([...theme.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]))
    expect(used.length).toBeGreaterThan(8)
    expect(used.filter((v) => !defined.has(v))).toEqual([])
  })
})
