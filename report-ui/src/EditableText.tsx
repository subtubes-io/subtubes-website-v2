"use client";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface Props {
  /** The Markdown source. */
  value: string;
  /** How it reads when not being edited. */
  children: ReactNode;
  /** Saves the new text. Rejects with the reason it was not saved. */
  onSave: (text: string) => Promise<void>;
  /** Without this the text is read-only: nothing to double-click. */
  enabled: boolean;
  label: string;
  /** A single line, such as a title. */
  single?: boolean;
  className?: string;
  placeholder?: string;
}

const AUTOSAVE_MS = 700;

/** Text that is edited where it stands: double-click (or Enter) shows the Markdown, typing saves by itself, and leaving the field shows it rendered again. */
export function EditableText({ value, children, onSave, enabled, label, single, className = "", placeholder }: Props) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle"), [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), saved = useRef(value), latest = useRef(draft), busy = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (!editing) { saved.current = value; setDraft(value); } }, [value, editing]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, editing]);
  const persist = (text: string): Promise<boolean> => {
    clearTimeout(timer.current);
    if (text === saved.current) return Promise.resolve(true);
    setStatus("saving"); setError("");
    const run = busy.current.then(() => onSave(text)).then(() => { saved.current = text; setStatus("saved"); return true; }, (cause: unknown) => { setStatus("idle"); setError(String(cause instanceof Error ? cause.message : cause)); return false; });
    busy.current = run.then(() => undefined);
    return run;
  };
  const change = (text: string) => {
    setDraft(text); latest.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(latest.current); }, AUTOSAVE_MS);
  };
  const start = () => { if (!enabled || editing) return; setDraft(value); latest.current = value; saved.current = value; setError(""); setStatus("idle"); setEditing(true); };
  const finish = async () => { if (await persist(latest.current)) setEditing(false); };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void finish(); }
    else if (single && event.key === "Enter") { event.preventDefault(); void finish(); }
  };
  useEffect(() => { if (editing) { const element = area.current; element?.focus(); element?.setSelectionRange(element.value.length, element.value.length); } }, [editing]);
  if (editing) {
    return <div className={`editable-text editing ${className}`}>
      <textarea ref={area} aria-label={`${label} (Markdown)`} rows={1} value={draft} placeholder={placeholder} spellCheck onChange={(event) => change(event.target.value)} onBlur={() => void finish()} onKeyDown={keys} />
      <span className="editable-status" role="status">{error ? "" : status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}</span>
      {error && <p role="alert" className="editable-error">{error}</p>}
    </div>;
  }
  return <div className={`editable-text${className}`} tabIndex={enabled ? 0 : undefined}
    onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("a, button")) start(); }}
    onKeyDown={(event) => { if (enabled && event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); start(); } }}>
    {children}
  </div>;
}
