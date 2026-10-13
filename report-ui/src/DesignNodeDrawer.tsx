"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { reportServices } from "./services";
import { useImageAttach } from "./useImageAttach";
import { InProgressIcon, CompletedIcon, NoStatusIcon, NodeStatusIcon, STATUS_LABEL } from "./DesignNodeStatus";
import type { DesignNodeStatus } from "./model/designs";

interface Config {
  node: { id: string; title: string; comment: string; kind?: string; status?: DesignNodeStatus };
  readOnly?: boolean;
  /** Edits are applied live; start/end bracket a typing session so history and autosave treat it as one edit. */
  onEdit: (field: "title" | "comment", value: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onClose: () => void;
  onStatus?: (status?: DesignNodeStatus) => void;
  render: (text: string) => ReactNode;
  extras?: ReactNode;
  /** Identifies the containing diagram so it can be copied for use in an AI prompt. */
  designId?: string;
  designIdLabel?: string;
}

/** Bottom drawer giving a node's title and Markdown description far more room than the canvas card. */
export function DesignNodeDrawer({ config }: { config: Config }) {
  const { node, readOnly } = config;
  const dialog = useRef<HTMLDialogElement>(null);
  const started = useRef(false);
  const [title, setTitle] = useState<string>();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [copied, setCopied] = useState<string>();
  const copiedTimer = useRef<number | undefined>(undefined);
  const latest = useRef(config);
  latest.current = config;
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      if (started.current) latest.current.onEnd();
      element.close();
    };
  }, []);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const copy = async (key: string, text: string) => {
    window.clearTimeout(copiedTimer.current);
    try { await reportServices.writeText(text); setCopied(key); }
    catch (error) { console.error("Copy failed", error); setCopied(`${key}-failed`); }
    copiedTimer.current = window.setTimeout(() => setCopied(undefined), 1800);
  };
  const label = (key: string, text: string) => copied === key ? "Copied" : copied === `${key}-failed` ? "Copy failed" : text;
  const idLabel = config.designIdLabel ?? "design ID";
  const editing = !readOnly && mode === "edit";
  const attach = useImageAttach({ value: node.comment, onChange: (value) => { begin(); config.onEdit("comment", value); }, disabled: readOnly });
  const begin = () => { if (!started.current) { started.current = true; config.onStart(); } };
  const end = () => { if (started.current) { started.current = false; config.onEnd(); } };
  return <dialog ref={dialog} className="design-node-drawer" aria-label={`Node details: ${node.title}`}
    onCancel={(event) => { event.preventDefault(); config.onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) config.onClose(); }}>
    <header className="design-node-drawer-head">
      {node.kind === "context" && <span className="design-node-drawer-kind">Context</span>}
      {readOnly && node.kind !== "context" && node.status && <span className={`design-node-drawer-status ${node.status}`}><NodeStatusIcon status={node.status} size={18} />{STATUS_LABEL[node.status]}</span>}
      {readOnly ? <h2>{node.title}</h2>
        : <input aria-label="Canvas node title" required maxLength={200} value={title ?? node.title}
          onChange={(event) => { begin(); setTitle(event.target.value); if (event.target.value.trim()) config.onEdit("title", event.target.value); }}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== node.title) config.onEdit("title", value);
            setTitle(undefined); end();
          }} />}
      <button type="button" onClick={config.onClose}>Close</button>
    </header>
    <div className="design-node-drawer-toolbar" role="toolbar" aria-label="Node description tools">
      {!readOnly && <div className="design-node-drawer-modes" role="group" aria-label="Description mode">
        {(["preview", "edit"] as const).map((item) => <button type="button" key={item} aria-pressed={mode === item}
          onClick={() => { end(); setMode(item); }}>{item === "preview" ? "Preview" : "Edit"}</button>)}
      </div>}
      {!readOnly && node.kind !== "context" && <div className="design-node-drawer-modes design-node-drawer-statuses" role="group" aria-label="Implementation status">
        {([[undefined, "No status", NoStatusIcon], ["in-progress", "In progress", InProgressIcon], ["completed", "Completed", CompletedIcon]] as const).map(([value, text, Icon]) =>
          <button type="button" key={text} aria-pressed={node.status === value} className={value} onClick={() => config.onStatus?.(value)}><Icon size={14} aria-hidden="true" />{text}</button>)}
      </div>}
      <button type="button" className="design-node-drawer-push" disabled={!node.comment} onClick={() => void copy("markdown", node.comment)}>{label("markdown", "Copy Markdown")}</button>
      <button type="button" title={node.id} onClick={() => void copy("node", node.id)}>{label("node", "Copy node ID")}</button>
      {config.designId && <button type="button" title={config.designId} onClick={() => void copy("design", config.designId!)}>{label("design", `Copy ${idLabel}`)}</button>}
      <span className="visually-hidden" role="status" aria-live="polite">{copied?.endsWith("-failed") ? "Copy failed" : copied ? "Copied to clipboard" : ""}</span>
    </div>
    <div className="design-node-drawer-body">
      {editing ? <div className="design-node-drawer-source">
        <label>Description (Markdown)
          <textarea {...attach.textareaProps} autoFocus maxLength={20000} value={node.comment} placeholder="Describe this node. Markdown, fenced code blocks and images are supported."
            onChange={(event) => { begin(); config.onEdit("comment", event.target.value); }}
            onBlur={(event) => { attach.textareaProps.onBlur(event); end(); }} />
        </label>
        {attach.controls}
      </div>
        : <section className="design-node-drawer-preview" aria-label="Node description">
          {config.extras}
          {node.comment ? config.render(node.comment) : <p className="loc">No description.{!readOnly && " Switch to Edit to add one."}</p>}
        </section>}
    </div>
  </dialog>;
}
