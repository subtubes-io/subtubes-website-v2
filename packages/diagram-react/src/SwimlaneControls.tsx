import { useState } from 'react'
import type { DiagramOp, LaneOrientation } from '@subtubes/diagram-core'
import { useDiagram, useGroups, useMeta, useSelection } from './context'

export function SwimlaneControls() {
  const { controller, ui } = useDiagram()
  const type = useMeta((s) => s.type)
  const groups = useGroups((s) => s.byId)
  const selection = useSelection((s) => s.selection)
  const [error, setError] = useState('')
  const lanes = Object.values(groups).filter((g) => g.lane).sort((a, b) => a.lane?.orientation === 'vertical' ? a.x - b.x : a.y - b.y)
  if (type !== 'swimlane' && lanes.length === 0) return null
  const selected = selection?.kind === 'group' ? lanes.find((g) => g.id === selection.id) : undefined
  const orientation = lanes[0]?.lane?.orientation ?? 'horizontal'
  const apply = (ops: DiagramOp[], summary: string) => {
    const result = controller.apply({ ops, summary, source: 'user' })
    setError(result.ok ? '' : result.message)
    return result.ok
  }
  const reorder = (direction: number) => {
    if (!selected) return
    const ids = lanes.map((g) => g.id)
    const index = ids.indexOf(selected.id)
    const other = index + direction
    if (other < 0 || other >= ids.length) return
    ;[ids[index], ids[other]] = [ids[other], ids[index]]
    apply([{ op: 'arrangeLanes', orientation, laneIds: ids }], 'Reorder swimlanes')
  }
  return (
    <div className="swimlane-controls" onPointerDown={(e) => e.stopPropagation()}>
      <button className="dg-btn" type="button" onClick={() => {
        const before = new Set(lanes.map((g) => g.id))
        if (!apply([{ op: 'createLane', lane: { title: `Lane ${lanes.length + 1}`, body: '', orientation } }], 'Add swimlane')) return
        const lane = controller.getSnapshot().groups.find((g) => g.lane && !before.has(g.id))
        if (lane) { ui.selection.getState().select({ kind: 'group', id: lane.id }); ui.edit.getState().editGroup(lane.id) }
      }}>Add lane</button>
      <select aria-label="Lane orientation" value={orientation} disabled={lanes.length === 0} onChange={(e) => {
        const next: LaneOrientation = e.target.value === 'vertical' ? 'vertical' : 'horizontal'
        apply([{ op: 'arrangeLanes', orientation: next }], 'Change swimlane orientation')
      }}>
        <option value="horizontal">Horizontal lanes</option><option value="vertical">Vertical lanes</option>
      </select>
      {selected && <>
        <button className="dg-btn" type="button" onClick={() => ui.edit.getState().editGroup(selected.id)}>Edit lane</button>
        <button className="dg-btn" type="button" aria-label="Move lane earlier" disabled={lanes[0].id === selected.id} onClick={() => reorder(-1)}>Earlier</button>
        <button className="dg-btn" type="button" aria-label="Move lane later" disabled={lanes.at(-1)?.id === selected.id} onClick={() => reorder(1)}>Later</button>
        <button className="dg-btn" type="button" onClick={() => apply([{ op: 'deleteLane', id: selected.id }], 'Delete swimlane (keep nodes)')}>Delete lane</button>
      </>}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
