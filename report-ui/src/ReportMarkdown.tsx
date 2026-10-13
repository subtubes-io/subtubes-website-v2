"use client";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { AttachmentImage } from "./AttachmentImage";
import { attachmentHash } from "./attachments";
import "./report-content.css";
import type { DesignRef } from "./model/types";
import { DesignRefSchema } from "./model/report-design-refs";
import { highlightCode } from "./syntax";

/** The custom scheme is parsed as IDs, never used as a browser URL. */
export function designLink(value: string): DesignRef | undefined {
  const match = /^design:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?$/.exec(value);
  if (!match) return;
  const parsed = DesignRefSchema.safeParse({ designId: match[1], ...(match[2] ? { nodeId: match[2] } : {}) });
  return parsed.success ? parsed.data : undefined;
}

export function reportFileLink(value: string, files: readonly string[]): string | undefined {
  let path: string;
  try { path = decodeURIComponent(value.startsWith("file:") ? value.slice(5) : value); }
  catch { return; }
  path = path.replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?)$/, "").replace(/^\.\//, "");
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || /^[A-Za-z][A-Za-z\d+.-]*:/.test(path)) return;
  if (files.includes(path)) return path;
  if (!path.includes("/")) {
    const matches = files.filter(file => file.split("/").at(-1) === path);
    if (matches.length === 1) return matches[0];
  }
}

interface MarkdownNode { type: string; value?: string; url?: string; children?: MarkdownNode[] }
function fileMentions(files: readonly string[]) {
  const names = [...new Set(files.flatMap(file => [file, file.split("/").at(-1)!]))]
    .filter(name => reportFileLink(name, files)).sort((a, b) => b.length - a.length);
  const pattern = names.length ? new RegExp(`(^|[\\s(\`])(${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?::\\d+(?:-\\d+)?)?(?=$|[\\s.,;:)\\]\`])`, "g") : undefined;
  return () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (!node.children || ["link", "linkReference", "code", "html", "image"].includes(node.type)) return;
      node.children = node.children.flatMap(child => {
        if (child.type === "inlineCode" && child.value) {
          const file = reportFileLink(child.value, files);
          if (file) return [{ type: "link", url: `file:${encodeURIComponent(file)}`, children: [child] }];
        }
        if (child.type !== "text" || !child.value || !pattern) { walk(child); return [child]; }
        const parts: MarkdownNode[] = [];
        let start = 0;
        for (const match of child.value.matchAll(pattern)) {
          const at = match.index! + match[1].length;
          if (at > start) parts.push({ type: "text", value: child.value.slice(start, at) });
          const text = match[0].slice(match[1].length);
          const file = reportFileLink(match[2], files)!;
          parts.push({ type: "link", url: `file:${encodeURIComponent(file)}`, children: [{ type: "text", value: text }] });
          start = match.index! + match[0].length;
        }
        if (!parts.length) return [child];
        if (start < child.value.length) parts.push({ type: "text", value: child.value.slice(start) });
        return parts;
      });
    };
    walk(tree);
  };
}

export function ReportMarkdown({ config }: { config: { text: string; onOpenDesign?: (ref: DesignRef) => void; files?: readonly string[]; onOpenFile?: (path: string) => void } }) {
  const files = config.files ?? [];
  return <div className="report-markdown"><ReactMarkdown
    remarkPlugins={files.length ? [fileMentions(files)] : []}
    urlTransform={(url) => attachmentHash(url) || designLink(url) || (config.onOpenFile && reportFileLink(url, files)) ? url : defaultUrlTransform(url)}
    components={{
      a: ({ href, children }) => {
        const ref = href && designLink(href);
        if (ref) return <button type="button" className="report-design-link" title="Open diagram in new tab" disabled={!config.onOpenDesign} onClick={() => config.onOpenDesign?.(ref)}>{children}</button>;
        const file = href && reportFileLink(href, files);
        if (file && config.onOpenFile) return <button type="button" className="report-design-link" title={`Review changes in ${file}`} onClick={() => config.onOpenFile?.(file)}>{children}</button>;
        if (href?.startsWith("file:")) return <span title="No saved diff is available for this file.">{children}</span>;
        return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
      // Reports are untrusted local data: remote images are never fetched. Only stored attachments, addressed by hash, are shown.
      img: ({ src, alt }) => { const hash = typeof src === "string" ? attachmentHash(src) : undefined; return hash ? <AttachmentImage hash={hash} alt={alt ?? ""} /> : <span>{alt || "Image omitted"}</span>; },
      code: ({ className, children }) => {
        const language = /(?:^|\s)language-([^\s]+)/.exec(className ?? "")?.[1]?.toLowerCase();
        if (!language) return <code>{children}</code>;
        const lines = highlightCode(String(children), language);
        return <code className={className}>{lines.map((tokens, index) => <span key={index}>{index > 0 ? "\n" : ""}{tokens.map((token, tokenIndex) => <span key={tokenIndex} className={token.className}>{token.text}</span>)}</span>)}</code>;
      },
    }}
  >{config.text}</ReactMarkdown></div>;
}
