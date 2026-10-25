import type { GroupDef, NodeDef } from './types'

// A group does not store its members: whatever is drawn inside its box belongs to it. A node is
// inside when its centre is, and another group is inside when its whole box is. Keeping this
// derived means the saved diagram needs nothing extra, and dragging a node out of a box takes
// it out of the group.
export function membersOf(group: GroupDef, nodes: NodeDef[], groups: GroupDef[]): { nodes: NodeDef[]; groups: GroupDef[] } {
  const inside = (x: number, y: number) => x >= group.x && x <= group.x + group.w && y >= group.y && y <= group.y + group.h
  return {
    nodes: nodes.filter((n) => inside(n.x + n.w / 2, n.y + n.h / 2)),
    groups: groups.filter(
      (g) => g.id !== group.id && g.x >= group.x && g.y >= group.y && g.x + g.w <= group.x + group.w && g.y + g.h <= group.y + group.h,
    ),
  }
}
