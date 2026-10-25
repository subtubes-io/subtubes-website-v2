import { memo, useState } from 'react'
import { useDiagram, useGroups } from './context'
import { beginEdit } from './beginEdit'
import { layerStyle } from './colors'
import { useIsSelected } from './hooks'
import { addNodeAt } from './actions'
import { toDiagram } from './beginConnect'

// Only the title bar and the border take the pointer, so dragging across the inside of a group still pans the canvas.
export const DiagramGroup = memo(function DiagramGroup({ id }: { id: string }) {
  const instance = useDiagram()
  const group = useGroups((s) => s.byId[id])
  const selected = useIsSelected('group', id)
  const [error, setError] = useState('')
  if (!group) return null

  const grab = (e: React.PointerEvent) => beginEdit(instance, e, 'group', id, 'move')
  const add = (x: number, y: number) => {
    setError('')
    const nodeId = addNodeAt(instance.controller, x, y, id, setError)
    if (nodeId) {
      instance.ui.selection.getState().select({ kind: 'node', id: nodeId })
      instance.ui.edit.getState().editNode(nodeId, 'title')
    }
  }

  return (
    <div
      className={`group${group.lane ? ' swimlane' : ''}${selected ? ' selected' : ''}`}
      data-lane-id={group.lane ? id : undefined}
      style={{ left: group.x, top: group.y, width: group.w, height: group.h, ...layerStyle(group.color) }}
    >
      <div
        className="group-bar"
        onPointerDown={grab}
        // Double-click the title to rename the group.
        onDoubleClick={(e) => {
          e.stopPropagation()
          instance.ui.edit.getState().editGroup(id)
        }}
      >
        <span className="group-title">{group.title}</span>
        {group.lane && <span className="lane-description">{group.lane.body || 'Double-click to edit lane title and description'}</span>}
      </div>
      {group.lane && (
        <div
          className="lane-content"
          role="button"
          tabIndex={0}
          aria-label={`Add node to ${group.title}`}
          title="Double-click to add a node"
          onPointerDown={(e) => {
            e.stopPropagation()
            instance.ui.selection.getState().select({ kind: 'group', id })
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            const at = toDiagram(instance, e.clientX, e.clientY)
            add(at.x, at.y)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(group.x + group.w / 2, group.y + 180)
            }
          }}
        />
      )}
      {error && <span className="lane-error" role="alert">{error}</span>}
      <span className="group-edge group-edge-s" onPointerDown={grab} />
      <span className="group-edge group-edge-w" onPointerDown={grab} />
      <span className="group-edge group-edge-e" onPointerDown={grab} />
    </div>
  )
})
