import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { EdgeState, GroupState, MetaState, NodeState } from '@subtubes/diagram-core'
import type { DiagramInstance } from './instance'
import type { ConnectState, EditState, HighlightState, SelectionState, ViewportState } from './ui'

// What a host supplies that the canvas does not know how to do itself.
export interface DiagramSlots {
  // Draws a node's content (the node's body is Markdown). Without it the text is shown as it is.
  renderMarkdown?: (source: string) => ReactNode
  openNodeContent?: (id: string) => void
}

export interface DiagramContextValue {
  instance: DiagramInstance
  slots: DiagramSlots
}

export const DiagramContext = createContext<DiagramContextValue | null>(null)

const useContextValue = () => {
  const value = useContext(DiagramContext)
  if (!value) throw new Error('This component must be inside a DiagramProvider.')
  return value
}

export const useDiagram = (): DiagramInstance => useContextValue().instance
export const useSlots = (): DiagramSlots => useContextValue().slots

// Reads one thing from one of the diagram's stores (or the canvas's), so a component re-renders only when that changes.
function useSelected<S, T>(api: StoreApi<S>, selector: (state: S) => T): T {
  return useStore(api, selector)
}

export const useNodes = <T,>(selector: (state: NodeState) => T) => useSelected(useDiagram().controller.stores.nodes, selector)
export const useEdges = <T,>(selector: (state: EdgeState) => T) => useSelected(useDiagram().controller.stores.edges, selector)
export const useGroups = <T,>(selector: (state: GroupState) => T) => useSelected(useDiagram().controller.stores.groups, selector)
export const useMeta = <T,>(selector: (state: MetaState) => T) => useSelected(useDiagram().controller.stores.meta, selector)
export const useViewport = <T,>(selector: (state: ViewportState) => T) => useSelected(useDiagram().ui.viewport, selector)
export const useSelection = <T,>(selector: (state: SelectionState) => T) => useSelected(useDiagram().ui.selection, selector)
export const useEditing = <T,>(selector: (state: EditState) => T) => useSelected(useDiagram().ui.edit, selector)
export const useConnecting = <T,>(selector: (state: ConnectState) => T) => useSelected(useDiagram().ui.connect, selector)
export const useHighlights = <T,>(selector: (state: HighlightState) => T) => useSelected(useDiagram().ui.highlight, selector)

// A store made elsewhere, used like the ones zustand's `create` makes: a hook with the store's own getState, setState and subscribe on it.
// For a host that has global code written against such hooks.
export function bindStore<S>(api: StoreApi<S>) {
  function useBound(): S
  function useBound<T>(selector: (state: S) => T): T
  function useBound<T>(selector?: (state: S) => T) {
    return useStore(api, selector as (state: S) => T)
  }
  return Object.assign(useBound, api)
}
