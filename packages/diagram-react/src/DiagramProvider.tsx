import type { ReactNode } from 'react'
import { DiagramContext } from './context'
import type { DiagramSlots } from './context'
import type { DiagramInstance } from './instance'

// Gives the canvas components below it a diagram to show: an instance (a controller and the canvas state for it) and what the host supplies.
export function DiagramProvider({ instance, slots = {}, children }: { instance: DiagramInstance; slots?: DiagramSlots; children: ReactNode }) {
  return <DiagramContext.Provider value={{ instance, slots }}>{children}</DiagramContext.Provider>
}
