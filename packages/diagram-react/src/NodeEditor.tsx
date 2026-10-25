import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '@subtubes/diagram-core'
import type { NodeDef } from '@subtubes/diagram-core'
import { useDiagram } from './context'

// Edits a node's title and Markdown content where they are. Click away or Cmd/Ctrl+Enter saves
// (one undoable change); Escape discards.
export function NodeEditor({ node, field }: { node: NodeDef; field: 'title' | 'body' }) {
  const { controller, ui } = useDiagram()
  const [title, setTitle] = useState(node.title)
  const [body, setBody] = useState(node.body)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = field === 'title' ? titleRef.current : bodyRef.current
    el?.focus()
    el?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const trimmed = title.trim()
    if (save && trimmed !== '') {
      const patch: { title?: string; body?: string } = {}
      if (trimmed !== node.title) patch.title = trimmed
      if (body !== node.body) patch.body = body
      if (Object.keys(patch).length > 0) {
        controller.apply({ ops: [{ op: 'updateNode', id: node.id, patch }], summary: `Edit node “${node.title}”`, source: 'user' })
      }
    }
    ui.edit.getState().end()
  }

  return (
    <div
      className="node-editor"
      // Pressing inside must not drag the node or pan the canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) finish(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          finish(true)
        }
      }}
    >
      <input
        ref={titleRef}
        className="node-edit-title"
        aria-label="Node title"
        value={title}
        maxLength={LIMITS.title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            bodyRef.current?.focus()
          }
        }}
      />
      <textarea
        ref={bodyRef}
        className="node-edit-body"
        aria-label="Node content (Markdown)"
        value={body}
        maxLength={LIMITS.body}
        spellCheck={false}
        onChange={(e) => setBody(e.target.value)}
      />
    </div>
  )
}
