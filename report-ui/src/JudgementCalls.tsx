"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { assumptions, needsConfirmation, type Decision } from "./model/decisions";
import { DecisionCard, DecisionComposer, type DecisionControls } from "./Decisions";

/** The file a decision is grouped under: its first line or file anchor, otherwise report-wide. */
export function decisionGroup(item: Decision) {
  for (const anchor of item.anchors) {
    if (anchor.type === "line") return anchor.anchor.path;
    if (anchor.type === "file") return anchor.file;
  }
  return item.anchors.some((anchor) => anchor.type === "node") ? "Diagram nodes" : "Report-wide";
}

/** The report's judgement calls: what people decided, overrode, accepted or deferred. New ones are recorded in a dialog. */
export function JudgementCalls({ controls }: { controls: DecisionControls }) {
  const [adding, setAdding] = useState(false);
  const all = controls.decisions;
  const active = all.filter((item) => item.status === "active");
  const humanCount = active.filter((item) => item.madeBy === "human").length;
  const guesses = assumptions(all);
  const pending = active.filter(needsConfirmation);
  const rest = active.filter((item) => !pending.includes(item));
  const groups = [...new Set(rest.map(decisionGroup))].sort((a, b) => (a === "Report-wide" ? -1 : b === "Report-wide" ? 1 : a.localeCompare(b)));
  return <section className="summary-section summary-judgement decisions-page" aria-label="Judgement behind this change">
    <div className="questions-heading"><div><h3>Judgement calls</h3>
      <p className="loc">What people chose, overrode, accepted or deferred while making this change.{all.length ? ` ${humanCount} human ${humanCount === 1 ? "decision" : "decisions"} · ${guesses.length} agent ${guesses.length === 1 ? "assumption" : "assumptions"} · ${pending.length} to confirm.` : ""}</p></div>
      <div className="question-actions">
        <button type="button" disabled={!controls.enabled} onClick={() => setAdding(true)}>Record a decision</button>
      </div></div>
    {!controls.enabled && <p role="status">Save this report to a project to record decisions.</p>}
    {controls.error && <p role="alert">{controls.error}</p>}
    {adding && <RecordDialog busy={controls.busy} onSave={controls.onCreate} onClose={() => setAdding(false)} />}
    {!active.length && <p className="empty">No judgement calls are recorded yet. Record the choices people made so a reader can see why the code is the way it is.</p>}
    {!!pending.length && <section className="decision-group" aria-label="Needs confirmation">
      <h4>Needs your confirmation ({pending.length})</h4>
      <p className="loc">Recorded by an agent. Confirm what is accurate, adopt an assumption as your own call, or edit it.</p>
      {pending.map((item) => <DecisionCard key={item.id} item={item} controls={controls} />)}
    </section>}
    {groups.map((group) => <section className="decision-group" key={group} aria-label={group}>
      <h4 className="loc">{group}</h4>
      {rest.filter((item) => decisionGroup(item) === group).map((item) => <DecisionCard key={item.id} item={item} controls={controls} />)}
    </section>)}
  </section>;
}

function RecordDialog({ busy, onSave, onClose }: { busy: boolean; onSave: Parameters<typeof DecisionComposer>[0]["onSave"]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="designs-modal decision-dialog" aria-label="Record a decision" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <DecisionComposer label="Record a decision" anchors={[]} busy={busy} onSave={onSave} onCancel={onClose} />
  </dialog>;
}
