import { fireEvent, screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

export type DiffAction = "decision";
const names: Record<DiffAction, RegExp> = { decision: /^Record a decision/ };

export const diffCode = (root: ParentNode, side: "old" | "new", line: number) => {
  const code = root.querySelector<HTMLElement>(`.diff-code[data-${side}-line="${line}"]`);
  if (!code) throw new Error(`No ${side} line ${line} in the diff.`);
  return code;
};
/** Right-clicks a line the way a pointer does: the browser's own selection is read at mouse-down. */
export function rightClickLine(root: ParentNode, side: "old" | "new", line: number) {
  const code = diffCode(root, side, line);
  fireEvent.mouseDown(code, { button: 2 });
  fireEvent.contextMenu(code, { button: 2, clientX: 40, clientY: 40 });
  return code;
}
/** Selects text between two code spans (the user's highlight), then right-clicks inside it. */
export function rightClickSelection(start: HTMLElement, end: HTMLElement = start, target: HTMLElement = end) {
  const range = document.createRange();
  range.setStart(start, 0); range.setEnd(end, end.childNodes.length);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent.mouseDown(target, { button: 2 });
  fireEvent.contextMenu(target, { button: 2, clientX: 40, clientY: 40 });
}
export const diffMenu = () => screen.getByRole("menu", { name: "Diff line actions" });
export const chooseDiffAction = (user: UserEvent, action: DiffAction) => user.click(screen.getByRole("menuitem", { name: names[action] }));
