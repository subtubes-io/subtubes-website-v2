import { memo } from 'react'
import { useConnecting, useDiagram, useEditing, useHighlights, useNodes, useSlots } from './context'
import { beginEdit } from './beginEdit'
import { layerStyle } from './colors'
import { useIsSelected } from './hooks'
import { NodeEditor } from './NodeEditor'

export const DiagramNode = memo(function DiagramNode({ id }: { id: string }) {
  const instance = useDiagram()
  const { renderMarkdown, openNodeContent } = useSlots()
  const node = useNodes((s) => s.byId[id])
  const selected = useIsSelected('node', id)
  const editing = useEditing((s) => (s.node?.id === id ? s.node : null))
  const isTarget = useConnecting((s) => s.target === id)
  const highlight = useHighlights((s) => s.nodes[id])
  if (!node) return null

  return (
    <article
      data-node-id={id}
      className={`node${selected ? ' selected' : ''}${editing ? ' editing' : ''}${isTarget ? ' connect-target' : ''}${highlight ? ` hl-${highlight}` : ''}`}
      style={{ left: node.x, top: node.y, width: node.w, height: node.h, ...layerStyle(node.color) }}
      // Pressing a node selects it and, if dragged, moves it (beginEdit also keeps the canvas from panning).
      onPointerDown={(e) => {
        if (editing || (e.target instanceof Element && e.target.closest('a, button'))) e.stopPropagation()
        else beginEdit(instance, e, 'node', id, 'move')
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (e.target instanceof Element && e.target.closest('a, button')) return
        const onTitle = (e.target as HTMLElement).closest('h2') !== null
        instance.ui.edit.getState().editNode(id, onTitle ? 'title' : 'body')
      }}
      onPointerEnter={() => instance.ui.connect.getState().hover(id)}
      onPointerLeave={() => instance.ui.connect.getState().leave()}
    >
      {editing ? (
        <NodeEditor node={node} field={editing.field} />
      ) : (
        <>
          <h2>{node.title}</h2>
          {openNodeContent && (
            <button
              className="node-expand"
              type="button"
              aria-label={`Open full content for ${node.title}`}
              title="View and edit full content"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                instance.ui.selection.getState().select({ kind: 'node', id })
                openNodeContent(id)
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
              </svg>
            </button>
          )}
          {renderMarkdown ? renderMarkdown(node.body) : <div className="dg-plain">{node.body}</div>}
        </>
      )}
    </article>
  )
})
