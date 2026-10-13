"use client";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { FileDiff, Hunk } from "./model/types";
import { DiffView } from "./DiffView";
import { highlightHunk, highlightLines } from "./syntax";

const content = (tokens: ReturnType<typeof highlightLines>) => tokens.map((line) => line.map((token) => token.text).join("")).join("\n");

test("registered grammars preserve source text and unsupported files stay plain", () => {
  for (const [path, source] of [
    ["src/example.ts", 'export const count: number = 42;\nconst value = "<script>";\n'],
    ["src/example.PY", 'def greet(name):\n    return "Hello " + name # greeting\n'],
  ]) {
    const lines = highlightLines(source, path);
    expect(content(lines)).toBe(source);
    expect(lines.flat().some((token) => token.className?.includes("hljs-keyword"))).toBe(true);
    expect(lines.flat().some((token) => token.className?.includes("hljs-string"))).toBe(true);
  }
  const unknown = highlightLines("const count = 42;", "example.txt");
  expect(unknown).toEqual([[{ text: "const count = 42;" }]]);
});

test("multiline lexer state is separate for before and after, including hidden preview lines", () => {
  const hunk: Hunk = { oldStart: 10, newStart: 20, changedLines: [], lines: [
    "-/* removed comment", '+const text = "value";', " const next = 42;", "-*/", "+const end = true;", "\\ No newline at end of file",
  ] };
  const syntax = highlightHunk(hunk, "test.ts");
  expect(syntax.before.get(11)?.some((token) => token.className?.includes("hljs-comment"))).toBe(true);
  expect(syntax.after.get(21)?.some((token) => token.className?.includes("hljs-keyword"))).toBe(true);
  expect(content(syntax.inline)).toBe(hunk.lines.join("\n"));
  expect(syntax.inline.at(-1)).toEqual([{ text: "\\ No newline at end of file" }]);
  const multiline = highlightLines('message = """first\nsecond\nthird"""\n', "test.py");
  expect(multiline[1]).toEqual([{ text: "second", className: "hljs-string" }]);
});

test("split and inline syntax keeps line numbers, markers, colors, and escaping intact", () => {
  const file: FileDiff = { path: "src/example.ts", status: "modified", additions: 1, deletions: 1, hunks: [
    { oldStart: 3, newStart: 3, changedLines: [3], lines: ['-const count = 1;', '+const count = "<script>alert(1)</script>";', " // context", "\\ No newline at end of file"] },
  ] };
  const { container, rerender } = render(<DiffView config={{ file, layout: "split", flags: [], onLayout: () => {} }} />);
  expect(container.querySelector(".diff-cell.d .hljs-keyword")?.textContent).toBe("const");
  expect(container.querySelector(".diff-cell.a .hljs-string")?.textContent).toBe('"<script>alert(1)</script>"');
  expect(container.querySelector(".diff-line-number")?.textContent).toBe("3");
  expect(container.querySelector("script")).toBeNull();
  rerender(<DiffView config={{ file, layout: "inline", flags: [], onLayout: () => {} }} />);
  expect(container.querySelector(".diff-inline .a")?.textContent).toBe(file.hunks[0].lines[1]);
  expect(container.querySelector(".diff-inline .d .hljs-number")?.textContent).toBe("1");
  expect(container.querySelector("script")).toBeNull();
});

test("Python highlights in both layouts and expanded lines share multiline state", () => {
  const file: FileDiff = { path: "test.py", status: "added", additions: 24, deletions: 0, hunks: [
    { oldStart: 0, newStart: 1, changedLines: [], lines: ['+def greet():', '+    message = """start', ...Array.from({ length: 20 }, () => "+inside string"), '+end"""', '+    return message'] },
  ] };
  const { container, rerender } = render(<DiffView config={{ file, layout: "split", flags: [], onLayout: () => {} }} />);
  expect(container.querySelector(".hljs-keyword")?.textContent).toBe("def");
  expect(container.querySelectorAll(".diff-row:not(.diff-column-head)")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Expand (4 more rows)" }));
  expect(container.querySelectorAll(".diff-row:not(.diff-column-head)")).toHaveLength(24);
  expect(container.querySelectorAll(".diff-row")[22].querySelector(".hljs-string")?.textContent).toBe("inside string");
  rerender(<DiffView config={{ file, layout: "inline", flags: [], onLayout: () => {} }} />);
  expect(container.querySelector(".diff-inline .hljs-keyword")?.textContent).toBe("def");
  expect(container.querySelectorAll(".diff-inline > div")).toHaveLength(25);
});

test("renamed files use the old filename grammar on the before side", () => {
  const hunk: Hunk = { oldStart: 1, newStart: 1, changedLines: [], lines: ["-def greet():", "+const greet = 1;"] };
  const syntax = highlightHunk(hunk, "new.ts", "old.py");
  expect(syntax.before.get(1)?.find((token) => token.className === "hljs-keyword")?.text).toBe("def");
  expect(syntax.after.get(1)?.find((token) => token.className === "hljs-keyword")?.text).toBe("const");
});
