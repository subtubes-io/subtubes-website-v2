"use client";

import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";

type State = "idle" | "copied" | "failed";

// A code block from the Markdown pages, with a button that copies its text.
export function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<State>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent ?? "");
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="code-block">
      <pre {...props} ref={pre}>{children}</pre>
      <button type="button" className="code-copy" onClick={copy} aria-label="Copy code">
        {state === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        <span>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
      </button>
      <span role="status" className="sr-only">{state === "copied" ? "Code copied" : state === "failed" ? "Could not copy" : ""}</span>
    </div>
  );
}
