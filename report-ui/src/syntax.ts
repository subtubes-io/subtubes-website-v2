import { common, createLowlight } from "lowlight";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import type { Element, Root, Text } from "hast";
import type { Hunk } from "./model/types";

const languages = [
  { name: "typescript", extensions: ["ts", "mts", "cts"], grammar: typescript },
  { name: "python", extensions: ["py", "pyw", "pyi"], grammar: python },
];
const highlighter = createLowlight(common);
for (const language of languages) highlighter.register(language.name, language.grammar);

export interface SyntaxToken { text: string; className?: string }
export type SyntaxLine = SyntaxToken[];

export function highlightLines(source: string, path: string): SyntaxLine[] {
  const extension = path.split(".").pop()?.toLowerCase();
  const language = languages.find((item) => item.extensions.includes(extension ?? ""));
  return highlightCode(source, language?.name);
}

export function highlightCode(source: string, language?: string): SyntaxLine[] {
  if (!language || !highlighter.registered(language)) return source.split("\n").map((text) => [{ text }]);
  const lines: SyntaxLine[] = [[]];
  const visit = (node: Root | Element | Text, classes: string[] = []) => {
    if (node.type === "text") {
      node.value.split("\n").forEach((text, index) => {
        if (index) lines.push([]);
        if (text) lines[lines.length - 1].push({ text, className: classes.join(" ") || undefined });
      });
    } else {
      const ownClasses = node.type === "element" && Array.isArray(node.properties.className)
        ? node.properties.className.map(String) : [];
      for (const child of node.children) {
        if (child.type === "element" || child.type === "text") visit(child, [...classes, ...ownClasses]);
      }
    }
  };
  visit(highlighter.highlight(language, source));
  return lines;
}

/** Tokenize each side independently so deleted text cannot change the after-side lexer state. */
export function highlightHunk(hunk: Hunk, path: string, oldPath = path) {
  const beforeSource = hunk.lines.filter((line) => line[0] !== "+" && line[0] !== "\\").map((line) => line.slice(1)).join("\n");
  const afterSource = hunk.lines.filter((line) => line[0] !== "-" && line[0] !== "\\").map((line) => line.slice(1)).join("\n");
  const beforeLines = highlightLines(beforeSource, oldPath), afterLines = highlightLines(afterSource, path);
  const before = new Map<number, SyntaxLine>(), after = new Map<number, SyntaxLine>();
  let oldLine = hunk.oldStart, newLine = hunk.newStart, oldIndex = 0, newIndex = 0;
  const inline = hunk.lines.map((line): SyntaxLine => {
    if (line[0] === "\\") return [{ text: line }];
    let tokens: SyntaxLine = [];
    if (line[0] !== "+") {
      tokens = beforeLines[oldIndex++];
      before.set(oldLine++, tokens);
    }
    if (line[0] !== "-") {
      tokens = afterLines[newIndex++];
      after.set(newLine++, tokens);
    }
    return [{ text: line.slice(0, 1) }, ...tokens];
  });
  return { before, after, inline };
}
