"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface Config {
  readOnly?: boolean;
  value: string; label: string; title?: boolean; disabled: boolean; placeholder?: string;
  /** Single-line fields that may be left blank, such as link labels. */
  optional?: boolean; maxLength?: number; className?: string;
  /** Renders the committed value (for example as Markdown) while the field is not being edited. */
  render?: (value: string) => ReactNode;
  autoStart?: boolean; onEnd?: () => void;
  onCommit: (value: string) => void;
  onSave: () => void;
  onStart: () => void;
}
export function DesignInlineField({ config }: { config: Config }) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(config.value);
  const finished = useRef(false);
  const original = useRef(config.value), autoStarted = useRef(false);
  const start = () => {
    if (config.disabled) return;
    original.current = config.value;
    config.onStart();
    finished.current = false; setValue(config.value); setEditing(true);
  };
  useEffect(() => { if (config.autoStart && !autoStarted.current) { autoStarted.current = true; start(); } }, []);
  const finish = (element: HTMLInputElement | HTMLTextAreaElement, cancel = false) => {
    if (finished.current) return true;
    if (!cancel && config.title && !config.optional && !value.trim()) {
      element.setCustomValidity("Enter a title before finishing.");
      element.reportValidity();
      queueMicrotask(() => { if (element.isConnected) element.focus(); });
      return false;
    }
    finished.current = true;
    if (cancel) config.onCommit(original.current);
    else if (value !== config.value || (config.title && value !== value.trim())) config.onCommit(config.title ? value.trim() : value);
    setEditing(false); config.onEnd?.();
    return true;
  };
  if (editing) {
    const props = {
      autoFocus: true, value, "aria-label": config.label, className: "design-inline-input",
      maxLength: config.maxLength ?? (config.title ? 200 : 20000), disabled: config.disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { event.currentTarget.setCustomValidity(""); setValue(event.target.value); config.onCommit(event.target.value); },
      onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { event.currentTarget.select(); },
      onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => finish(event.currentTarget),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); finish(event.currentTarget, true); }
        else if (event.key === "Enter" && !event.nativeEvent.isComposing && (config.title || event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(event.currentTarget); }
        else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (finish(event.currentTarget)) config.onSave(); }
      },
    };
    return config.title ? <input {...props} required={!config.optional} /> : <textarea {...props} />;
  }
  const props = {
    className: config.className ?? (config.title ? "design-inline-title" : `design-inline-body${config.value ? "" : " loc"}`),
    title: config.readOnly ? undefined : `Double-click to edit. ${config.title ? "Enter" : "Command/Control+Enter"} to finish; Escape to cancel.`,
    onDoubleClick: (event: React.MouseEvent) => { if (config.readOnly) return; event.stopPropagation(); start(); },
  };
  if (config.render && config.value) return <div {...props}>{config.render(config.value)}</div>;
  return config.title ? <strong {...props}>{config.value}</strong> : <span {...props}>{config.value || config.placeholder || (config.readOnly ? "" : "Double-click to add a comment")}</span>;
}
