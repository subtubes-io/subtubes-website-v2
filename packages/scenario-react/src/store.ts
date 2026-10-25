import { create } from 'zustand'
import { defaultInput, runScenario, validateScenario } from '@subtubes/scenario-core'
import type { GraphModel, Scenario, ScenarioIssue, Trace, Values } from '@subtubes/scenario-core'

export type PlayStatus = 'idle' | 'playing' | 'paused' | 'finished'

export interface RunOptions {
  autoplay?: boolean
  // Step to show first; later steps stay hidden until played or sought.
  seek?: number
  // Whether a finished run is reported to the host (the app posts it to the chat). Off when
  // the run was started by something that already has the result, like an assistant's tool call.
  report?: boolean
}

interface SimulationState {
  scenarios: Scenario[]
  activeId: string | null
  input: Values
  trace: Trace | null
  // Index of the step currently shown; steps after it are not revealed yet.
  cursor: number
  status: PlayStatus
  // Milliseconds each step stays on screen while playing.
  stepMs: number
  panelOpen: boolean
  // Increments for every new run, so listeners can tell a new run from a replay.
  runId: number
  // True for a run that was played from the start, as opposed to one reopened at a given
  // step; only played runs are worth reporting.
  reportable: boolean
  // Fade the rest of the diagram while a run is on screen. A display preference the host
  // acts on; the simulation itself does not care.
  focusMode: boolean
  issues: ScenarioIssue[]
  // The problems list is closed (it comes back with the next scenario, or when reopened from the header).
  issuesHidden: boolean
  setIssuesHidden: (hidden: boolean) => void
  // Checks the selected scenario against the diagram as it is now. For when the diagram changed under a scenario that is
  // already selected; nothing happens when the problems are the same.
  refreshIssues: () => void

  registerScenarios: (scenarios: Scenario[]) => void
  // Takes a scenario out of this design. If it was the one selected, the next one is, or none when it was the last.
  removeScenario: (id: string) => void
  // Adds a scenario to this design, and selects it when none is selected. Does not check it; see check.ts.
  addScenario: (scenario: Scenario) => void
  // Swaps a scenario for a new definition with the same id, keeping its place in the list. If it is the selected one,
  // the input resets to the new defaults and any run is cleared, since the run was of the old steps.
  replaceScenario: (scenario: Scenario) => void
  openPanel: () => void
  closePanel: () => void
  setFocusMode: (on: boolean) => void
  selectScenario: (id: string) => void
  run: (options?: RunOptions) => void
  // Selects a scenario, sets its input and runs it: the entry point for callers like the chat.
  runWith: (scenarioId: string, input: Values, options?: RunOptions) => void
  play: () => void
  pause: () => void
  stepForward: () => void
  stepBack: () => void
  seek: (index: number) => void
  reset: () => void
  setStepMs: (ms: number) => void
}

export function findScenario(scenarios: Scenario[], id: string | null) {
  return scenarios.find((s) => s.id === id)
}

// A player's state. A host makes one per diagram it plays scenarios on (the Subtubes app has one for the open design, and
// a report makes its own over a saved snapshot), so each has its own diagram, scenarios and timer. `graph` says where
// to get the diagram when a scenario is run or checked: the player never reads a diagram itself.
export function createSimulationStore(graph: () => GraphModel) {
  return create<SimulationState>()((set, get) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    // Advances one step on a timer until the trace ends.
    const schedule = () => {
      stopTimer()
      timer = setTimeout(() => {
        const { trace, cursor, status } = get()
        if (!trace || status !== 'playing') return
        if (cursor >= trace.steps.length - 1) {
          set({ status: 'finished' })
          return
        }
        const next = cursor + 1
        set({ cursor: next, status: next >= trace.steps.length - 1 ? 'finished' : 'playing' })
        if (get().status === 'playing') schedule()
      }, get().stepMs)
    }

    const clearRun = () => {
      stopTimer()
      return { trace: null, cursor: -1, status: 'idle' as PlayStatus }
    }

    return {
      scenarios: [],
      activeId: null,
      input: {},
      trace: null,
      cursor: -1,
      status: 'idle',
      stepMs: 1100,
      panelOpen: false,
      runId: 0,
      reportable: false,
      focusMode: true,
      issues: [],
      issuesHidden: false,
      setIssuesHidden: (issuesHidden) => set({ issuesHidden }),

      refreshIssues: () => {
        const scenario = findScenario(get().scenarios, get().activeId)
        if (!scenario) return
        const issues = validateScenario(scenario, graph())
        if (JSON.stringify(issues) !== JSON.stringify(get().issues)) set({ issues, issuesHidden: issues.length === 0 ? get().issuesHidden : false })
      },

      registerScenarios: (scenarios) => {
        set({ scenarios })
        const { activeId } = get()
        if (activeId && !findScenario(scenarios, activeId)) set({ activeId: null, input: {}, issues: [], ...clearRun() })
        if (!get().activeId && scenarios.length > 0) get().selectScenario(scenarios[0].id)
      },

      addScenario: (scenario) => {
        set((s) => ({ scenarios: [...s.scenarios, scenario] }))
        if (!get().activeId) get().selectScenario(scenario.id)
      },

      replaceScenario: (scenario) => {
        const { scenarios, activeId } = get()
        if (!scenarios.some((s) => s.id === scenario.id)) return
        set({ scenarios: scenarios.map((s) => (s.id === scenario.id ? scenario : s)) })
        if (activeId === scenario.id) get().selectScenario(scenario.id)
      },

      removeScenario: (id) => {
        const { scenarios, activeId } = get()
        const index = scenarios.findIndex((s) => s.id === id)
        if (index < 0) return
        const rest = scenarios.filter((s) => s.id !== id)
        set({ scenarios: rest })
        if (activeId !== id) return
        const next = rest[Math.min(index, rest.length - 1)]
        if (next) get().selectScenario(next.id)
        else set({ activeId: null, input: {}, issues: [], ...clearRun() })
      },

      openPanel: () => set({ panelOpen: true }),

      setFocusMode: (focusMode) => set({ focusMode }),

      closePanel: () => {
        stopTimer()
        set((s) => ({ panelOpen: false, status: s.status === 'playing' ? 'paused' : s.status }))
      },

      selectScenario: (id) => {
        const scenario = findScenario(get().scenarios, id)
        if (!scenario) return
        set({
          activeId: id,
          input: defaultInput(scenario),
          issues: validateScenario(scenario, graph()),
          issuesHidden: false,
          ...clearRun(),
        })
      },

      run: ({ autoplay = true, seek = 0, report = true } = {}) => {
        const { scenarios, activeId, input } = get()
        const scenario = findScenario(scenarios, activeId)
        if (!scenario) return
        const trace = runScenario(graph(), scenario, input)
        const cursor = Math.min(Math.max(seek, 0), trace.steps.length - 1)
        const atEnd = cursor >= trace.steps.length - 1
        stopTimer()
        set((s) => ({
          trace,
          cursor,
          status: atEnd ? 'finished' : autoplay ? 'playing' : 'paused',
          runId: s.runId + 1,
          reportable: autoplay && seek === 0 && report,
          issues: validateScenario(scenario, graph()),
          panelOpen: true,
        }))
        if (get().status === 'playing') schedule()
      },

      runWith: (scenarioId, input, options) => {
        const scenario = findScenario(get().scenarios, scenarioId)
        if (!scenario) return
        stopTimer()
        set({ activeId: scenarioId, input: { ...defaultInput(scenario), ...input }, panelOpen: true })
        get().run(options)
      },

      play: () => {
        const { trace, cursor } = get()
        if (!trace) return get().run()
        if (cursor >= trace.steps.length - 1) set({ cursor: 0 })
        set({ status: 'playing' })
        schedule()
      },

      pause: () => {
        stopTimer()
        set((s) => ({ status: s.status === 'playing' ? 'paused' : s.status }))
      },

      stepForward: () => {
        const { trace, cursor } = get()
        if (!trace) return get().run({ autoplay: false })
        stopTimer()
        const next = Math.min(cursor + 1, trace.steps.length - 1)
        set({ cursor: next, status: next >= trace.steps.length - 1 ? 'finished' : 'paused' })
      },

      stepBack: () => {
        const { trace, cursor } = get()
        if (!trace) return
        stopTimer()
        set({ cursor: Math.max(cursor - 1, 0), status: 'paused' })
      },

      seek: (index) => {
        const { trace } = get()
        if (!trace) return
        stopTimer()
        const cursor = Math.min(Math.max(index, 0), trace.steps.length - 1)
        set({ cursor, status: cursor >= trace.steps.length - 1 ? 'finished' : 'paused' })
      },

      reset: () => {
        const { trace } = get()
        stopTimer()
        if (trace) set({ cursor: 0, status: 'paused' })
      },

      setStepMs: (ms) => {
        set({ stepMs: ms })
        if (get().status === 'playing') schedule()
      },
    }
  })
}

export type SimulationStore = ReturnType<typeof createSimulationStore>
