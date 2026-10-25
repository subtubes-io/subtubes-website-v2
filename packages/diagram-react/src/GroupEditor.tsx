import { useEffect, useRef, useState } from 'react'
import { LIMITS } from '@subtubes/diagram-core'
import { useDiagram, useEditing, useGroups } from './context'

// Renames a group where its title is. Enter or clicking away saves (one undoable change); Escape discards.
export function GroupEditor() {
  const id = useEditing((s) => s.group)
  const group = useGroups((s) => (id ? s.byId[id] : undefined))
  if (!id || !group) return null
  if (group.lane) return <LaneInput key={id} id={id} title={group.title} body={group.lane.body} x={group.x} y={group.y} width={group.w} />
  return <TitleInput key={id} id={id} title={group.title} at={{ x: group.x + 14, y: group.y + 8 }} width={Math.max(140, group.w - 28)} />
}

function LaneInput({ id, title, body, x, y, width }: { id: string; title: string; body: string; x: number; y: number; width: number }) {
  const { controller, ui } = useDiagram()
  const [name, setName] = useState(title)
  const [description, setDescription] = useState(body)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const save = () => {
    const result = controller.apply({ source: 'user', summary: `Edit swimlane "${title}"`, ops: [{ op: 'updateLane', id, patch: { title: name.trim(), body: description } }] })
    if (!result.ok) { setError(result.message); return }
    ui.edit.getState().end()
  }
  return (
    <form className="lane-edit" aria-label="Edit swimlane" style={{ left: x + 8, top: y + 8, width: Math.max(240, width - 16) }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); save() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); ui.edit.getState().end() } }}>
      <label>Title<input ref={ref} aria-label="Lane title" value={name} required maxLength={LIMITS.title} onChange={(e) => setName(e.target.value)} /></label>
      <label>Description<textarea aria-label="Lane description" value={description} maxLength={LIMITS.body} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div><button className="dg-btn" type="button" onClick={() => ui.edit.getState().end()}>Cancel</button> <button className="dg-btn" type="submit">Save lane</button></div>
    </form>
  )
}

function TitleInput({ id, title, at, width }: { id: string; title: string; at: { x: number; y: number }; width: number }) {
  const { controller, ui } = useDiagram()
  const [value, setValue] = useState(title)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const next = value.trim()
    // An empty name is refused: the group keeps the one it had.
    if (save && next !== '' && next !== title) {
      controller.apply({ ops: [{ op: 'updateGroup', id, patch: { title: next } }], summary: `Rename group “${title}”`, source: 'user' })
    }
    ui.edit.getState().end()
  }

  return (
    <input
      ref={ref}
      className="group-edit"
      aria-label="Group name"
      value={value}
      maxLength={LIMITS.title}
      style={{ left: at.x, top: at.y, width }}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
