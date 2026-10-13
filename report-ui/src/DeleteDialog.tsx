"use client";
import { useEffect, useRef, useState } from "react";

interface Config {
  kind: "project" | "report" | "board" | "ticket" | "design" | "walkthrough";
  name: string;
  reportCount?: number;
  /** Replaces the default consequence text that follows the name. */
  consequence?: string;
  onCancel: () => void;
  onConfirm: (confirmation: string) => Promise<void>;
}

export function DeleteDialog({ config }: { config: Config }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    input.current?.focus();
    return () => { element.close(); if (restore?.isConnected) restore.focus(); };
  }, []);
  const count = config.reportCount ?? 0;
  const consequence = config.consequence ?? (config.kind === "project" ? ` and all ${count} saved ${count === 1 ? "report" : "reports"}` : "");
  const submit = async () => {
    if (confirmation !== "Delete me" || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try { await config.onConfirm(confirmation); }
    catch (failure) { console.error(failure); setError(String(failure)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="delete-dialog" aria-labelledby="delete-title" aria-describedby="delete-description"
    onCancel={(event) => { event.preventDefault(); if (!busy) config.onCancel(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) config.onCancel(); } }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id="delete-title">Delete {config.kind}?</h2>
      <p id="delete-description">Permanently delete <strong>{config.name}</strong>{consequence}? This cannot be undone.</p>
      <label htmlFor="delete-confirmation">Type <strong>Delete me</strong> to confirm</label>
      <input ref={input} id="delete-confirmation" autoComplete="off" spellCheck={false} value={confirmation} disabled={busy}
        onChange={(event) => setConfirmation(event.target.value)} aria-describedby={error ? "delete-error" : undefined} />
      {error && <p id="delete-error" role="alert">{error}</p>}
      <div className="delete-actions"><button type="button" disabled={busy} onClick={config.onCancel}>Cancel</button>
        <button className="danger" type="submit" disabled={busy || confirmation !== "Delete me"}>{busy ? "Deleting..." : `Delete ${config.kind}`}</button></div>
    </form>
  </dialog>;
}
