import type { Hunk } from "./model/types";

export type DiffLayout = "inline" | "split";
export const PREVIEW_LINES = 20;
export interface DiffRow {
  old?: { text: string; line: number; changed: boolean };
  next?: { text: string; line: number; changed: boolean };
}

export function splitRows(h: Hunk): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = h.oldStart, newLine = h.newStart;
  let removed: NonNullable<DiffRow["old"]>[] = [], added: NonNullable<DiffRow["next"]>[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ old: removed[i], next: added[i] });
    removed = []; added = [];
  };
  for (const line of h.lines) {
    if (line.startsWith("-")) {
      if (added.length) flush();
      removed.push({ text: line.slice(1), line: oldLine++, changed: true });
    } else if (line.startsWith("+")) added.push({ text: line.slice(1), line: newLine++, changed: true });
    else if (line.startsWith("\\")) {
      flush();
      rows.push({ old: { text: line, line: 0, changed: false }, next: { text: line, line: 0, changed: false } });
    } else {
      flush();
      rows.push({ old: { text: line.slice(1), line: oldLine++, changed: false }, next: { text: line.slice(1), line: newLine++, changed: false } });
    }
  }
  flush();
  return rows;
}
