import { beginConnect, sidePoint } from './beginConnect'
import { arrowBase } from './colors'
import { useConnecting, useDiagram, useEditing, useNodes } from './context'

const SIDES = ['n', 'e', 's', 'w'] as const
const LABEL = { n: 'top', e: 'right', s: 'bottom', w: 'left' } as const

// The dots that appear when the pointer is over a node: drag one onto another node to connect them.
// They sit outside the node, which clips its contents.
export function ConnectHandles() {
  const instance = useDiagram()
  const hovered = useConnecting((s) => s.hovered)
  const dragging = useConnecting((s) => s.source !== null)
  const node = useNodes((s) => (hovered ? s.byId[hovered] : undefined))
  const editing = useEditing((s) => s.node?.id === hovered)
  if (!hovered || !node || dragging || editing) return null

  return (
    <div className="connect-box" style={{ left: node.x, top: node.y, width: node.w, height: node.h }}>
      {SIDES.map((side) => (
        <span
          key={side}
          className={`connect-handle connect-${side}`}
          role="presentation"
          data-connect={side}
          title={`Drag onto another node to connect (${LABEL[side]})`}
          onPointerEnter={() => instance.ui.connect.getState().hover(hovered)}
          onPointerLeave={() => instance.ui.connect.getState().leave()}
          onPointerDown={(e) => beginConnect(instance, e, hovered, side)}
        />
      ))}
    </div>
  )
}

// The line being dragged out, from the handle to the pointer.
export function ConnectPreview() {
  const { uid } = useDiagram()
  const source = useConnecting((s) => s.source)
  const side = useConnecting((s) => s.side)
  const cursor = useConnecting((s) => s.cursor)
  const target = useConnecting((s) => s.target)
  const from = useNodes((s) => (source ? s.byId[source] : undefined))
  if (!source || !from || !cursor) return null
  const a = sidePoint(from, side)
  return (
    <svg className="connect-preview" width={1} height={1} aria-hidden="true">
      <path d={`M ${a.x} ${a.y} L ${cursor.x} ${cursor.y}`} className={target ? 'connect-line ready' : 'connect-line'} markerEnd={`url(#${arrowBase(uid)})`} />
    </svg>
  )
}
