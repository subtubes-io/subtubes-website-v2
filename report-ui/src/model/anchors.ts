import { z } from "zod/v3";
import type { FileDiff, Hunk } from "./types";

export const lineSide = z.enum(["old", "new"]);
export const lineAnchor = z.object({
  file: z.string().min(1), path: z.string().min(1), side: lineSide,
  line: z.number().int().positive(), text: z.string(),
  context: z.array(z.object({ text: z.string(), oldLine: z.number().int().positive().optional(), newLine: z.number().int().positive().optional() })).min(1).max(7),
}).superRefine((anchor, ctx) => {
  const rows = anchor.context.filter((row) => (anchor.side === "old" ? row.oldLine : row.newLine) === anchor.line);
  if (rows.length !== 1 || rows[0].text.slice(1) !== anchor.text) ctx.addIssue({ code: "custom", message: "Anchor text must match its saved context line." });
});
export type LineAnchor = z.infer<typeof lineAnchor>;
export type LineSide = z.infer<typeof lineSide>;

export function numberedHunk(hunk: Hunk): LineAnchor["context"] {
  let oldLine = hunk.oldStart, newLine = hunk.newStart;
  return hunk.lines.map((text) => {
    if (text.startsWith("\\")) return { text };
    if (text.startsWith("-")) return { text, ...(oldLine > 0 ? { oldLine: oldLine++ } : {}) };
    if (text.startsWith("+")) return { text, ...(newLine > 0 ? { newLine: newLine++ } : {}) };
    if (text.startsWith(" ")) return { text, ...(oldLine > 0 ? { oldLine: oldLine++ } : {}), ...(newLine > 0 ? { newLine: newLine++ } : {}) };
    return { text };
  });
}

export function captureAnchor(file: FileDiff, side: LineSide, line: number, expectedText: string): LineAnchor {
  const key = side === "old" ? "oldLine" : "newLine";
  const matches = file.hunks.flatMap((hunk) => {
    const rows = numberedHunk(hunk);
    return rows.flatMap((row, index) => row[key] === line ? [{ row, index, rows }] : []);
  });
  if (matches.length !== 1) throw new Error("Select a unique real line in this report's saved diff.");
  const { row, index, rows } = matches[0];
  if (row.text.slice(1) !== expectedText) throw new Error("The saved diff changed. Reopen the report before using this line.");
  return { file: file.path, path: side === "old" ? file.oldPath ?? file.path : file.path, side, line, text: expectedText, context: rows.slice(Math.max(0, index - 3), index + 4) };
}
