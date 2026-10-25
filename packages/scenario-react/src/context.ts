import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { SimulationStore } from './store'

// Which simulation the player components show. A host wraps them in `SimulationContext.Provider` with a store it made
// (`createSimulationStore`); a host with one player for the whole app can instead name it once with
// `setDefaultSimulationStore`, and the components use it wherever there is no provider.
export const SimulationContext = createContext<SimulationStore | null>(null)

let fallback: SimulationStore | null = null
export function setDefaultSimulationStore(store: SimulationStore | null) {
  fallback = store
}

export function useSimStore(): SimulationStore {
  const store = useContext(SimulationContext) ?? fallback
  if (!store) throw new Error('No simulation store: wrap the player in <SimulationContext.Provider value={createSimulationStore(...)}> or call setDefaultSimulationStore.')
  return store
}

export function useSim<T>(selector: (state: ReturnType<SimulationStore['getState']>) => T): T {
  return useStore(useSimStore(), selector)
}
