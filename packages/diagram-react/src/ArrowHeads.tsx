import { arrowId, colorCss } from './colors'

// The arrow heads for a set of lines: the usual one with `id`, and one per colour the lines use.
export function ArrowHeads({ id, colors }: { id: string; colors: (string | undefined)[] }) {
  const used = [...new Set(colors.filter((c): c is string => c !== undefined && colorCss(c) !== undefined))]
  return (
    <>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" className="arrow-head" />
      </marker>
      {used.map((color) => (
        <marker key={color} id={arrowId(id, color)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" className="arrow-head" style={{ fill: colorCss(color) }} />
        </marker>
      ))}
    </>
  )
}
