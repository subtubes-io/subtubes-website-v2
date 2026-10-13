"use client";
import { useEffect, useRef, useState } from "react";
import type { DesignSummary } from "./model/designs";
import type { ReportSwimlane } from "./model/report-swimlanes";
import { reportServices } from "./services";

const kindLabel = { swimlane: "Swimlane", system: "System" } as const;
const messageOf = (cause: unknown) => String(cause instanceof Error ? cause.message : cause);

/** Chooses saved designs to copy into the open report as frozen snapshots. */
export function DesignPicker({ attached, onAdd, onClose }: { attached: ReportSwimlane[]; onAdd: (designId: string) => Promise<void>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const search = useRef<HTMLInputElement>(null), [query, setQuery] = useState("");
  const [designs, setDesigns] = useState<DesignSummary[]>(), [error, setError] = useState(""), [chosen, setChosen] = useState<string[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    search.current?.focus();
    return () => { element.close(); if (restore?.isConnected) restore.focus(); };
  }, []);
  useEffect(() => {
    let current = true;
    reportServices.designs({ action: "list" }).then((result) => { if (current) setDesigns(result.designs); }, (cause: unknown) => { if (current) setError(`Could not load designs: ${messageOf(cause)}`); });
    return () => { current = false; };
  }, []);
  const taken = (design: DesignSummary) => attached.some((item) => item.source?.designId === design.id && item.source.revision === design.revision);
  const shown = designs?.filter((design) => reportServices.designVisible(design.id)).filter((design) => design.name.toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: string, on: boolean) => setChosen((ids) => on ? [...ids, id] : ids.filter((item) => item !== id));
  const add = async () => {
    setBusy(true); setError("");
    const done: string[] = [];
    try {
      for (const id of chosen) { await onAdd(id); done.push(id); }
      close.current();
    } catch (cause) { setError(messageOf(cause)); setChosen((ids) => ids.filter((id) => !done.includes(id))); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="design-picker" aria-label="Add designs to this report" onCancel={(event) => { event.preventDefault(); if (!busy) close.current(); }}>
    <h2>Add designs to this report</h2>
    <p className="loc">Each design is copied as it is now and frozen. Later edits to the design will not change this report.</p>
    <input ref={search} type="search" className="design-picker-search" aria-label="Search designs by name" placeholder="Search designs by name" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className="design-picker-error">{error}</p>}
    {!designs && !error && <p role="status" className="loc">Loading designs…</p>}
    {designs && !designs.length && <p className="design-picker-empty">No designs yet. Create a swimlane or system design in Designs, then come back to add it.</p>}
    {!!designs?.length && (shown?.length
      ? <div className="design-picker-table">
        <table aria-label="Saved designs">
          <thead><tr><th scope="col" className="design-picker-check"><span className="sr-only">Select</span></th><th scope="col">Name</th><th scope="col">Type</th></tr></thead>
          <tbody>
            {shown.map((design) => {
              const already = taken(design), disabled = already || busy;
              return <tr key={design.id} className={`${chosen.includes(design.id) ? "chosen" : ""}${already ? " taken" : ""}`} title={already ? "This revision is already in the report" : undefined}
                onClick={() => { if (!disabled) toggle(design.id, !chosen.includes(design.id)); }}>
                <td className="design-picker-check"><input type="checkbox" aria-label={`Select ${design.name}`} disabled={disabled} checked={chosen.includes(design.id)}
                  onClick={(event) => event.stopPropagation()} onChange={(event) => toggle(design.id, event.target.checked)} /></td>
                <td className="design-picker-name">{design.name}</td>
                <td>{kindLabel[design.kind]}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      : <p className="design-picker-empty">No designs match “{query.trim()}”.</p>)}
    <div className="design-picker-actions">
      <button type="button" disabled={busy} onClick={() => close.current()}>Cancel</button>
      <button type="button" className="primary" disabled={busy || !chosen.length} onClick={() => void add()}>{busy ? "Adding…" : chosen.length > 1 ? `Add ${chosen.length} designs` : "Add design"}</button>
    </div>
  </dialog>;
}
