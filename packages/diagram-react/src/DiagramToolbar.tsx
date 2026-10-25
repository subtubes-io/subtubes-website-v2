import { ColorControl } from './ColorControl'
import { EdgeStyleControl } from './EdgeStyleControl'
import { SwimlaneControls } from './SwimlaneControls'

// The title along the top, and the controls for whatever is selected: its colour, and for an edge its line.
export function DiagramToolbar({ title }: { title: string }) {
  return (
    <div className="canvas-head">
      <h1>{title}</h1>
      <div className="canvas-tools">
        <EdgeStyleControl />
        <ColorControl />
      </div>
      <SwimlaneControls />
    </div>
  )
}
