import type { DiagramController } from '@subtubes/diagram-core'
import { createCanvasUi } from './ui'
import type { CanvasUi } from './ui'

// One diagram on screen: the controller that holds it and the state of the canvas that shows it. Make one for each diagram a page shows,
// and give it to a DiagramProvider.
export interface DiagramInstance {
  // Unique, so the ids a canvas puts in the page (arrow heads) do not meet another canvas's.
  readonly uid: string
  readonly controller: DiagramController
  readonly ui: CanvasUi
  // The element the canvas draws in, so pointer positions can be turned into diagram positions. Set by DiagramCanvas.
  readonly surface: { el: HTMLElement | null }
  // Stops what the instance listens to. After it, the controller is left as it is.
  dispose(): void
}

let counter = 0

export function createDiagramInstance(controller: DiagramController): DiagramInstance {
  const ui = createCanvasUi()

  // What the diagram is now makes the canvas forget what it can no longer show: an edit in progress on something that is gone (deleted, or
  // another diagram loaded) ends with it, and so does a selection of it.
  const dropWhatIsGone = () => {
    const next = controller.getSnapshot()
    const editing = ui.edit.getState()
    if (
      (editing.node && !next.nodes.some((n) => n.id === editing.node!.id)) ||
      (editing.edge && !next.edges.some((e) => e.id === editing.edge)) ||
      (editing.group && !next.groups.some((g) => g.id === editing.group))
    ) {
      editing.end()
    }
    const { selection, clearSelection } = ui.selection.getState()
    if (!selection) return
    const collection = selection.kind === 'node' ? next.nodes : selection.kind === 'group' ? next.groups : next.edges
    if (!collection.some((item) => item.id === selection.id)) clearSelection()
  }
  const offs = [
    controller.subscribe(dropWhatIsGone),
    // Another diagram is not the one that was selected, even where the ids are the same.
    controller.onLoad(() => {
      ui.edit.getState().end()
      ui.selection.getState().clearSelection()
    }),
  ]

  return {
    uid: `dg${++counter}`,
    controller,
    ui,
    surface: { el: null },
    dispose: () => offs.forEach((off) => off()),
  }
}
