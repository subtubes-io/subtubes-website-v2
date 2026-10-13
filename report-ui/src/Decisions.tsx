"use client";
import { useState } from "react";
import { needsConfirmation, type Decision, type DecisionAnchor, type DecisionAnchorInput, type DecisionKind, type HumanDecisionDraft } from "./model/decisions";
import { reportServices } from "./services";
import { ReportMarkdown } from "./ReportMarkdown";

export const KIND_LABELS: Record<DecisionKind, string> = {
  direction: "Direction", tradeoff: "Trade-off", override: "Overrode the AI", "risk-accepted": "Risk accepted", scope: "Scope", deferred: "Deferred",
};
export const KIND_HELP: Record<DecisionKind, string> = {
  direction: "A person chose the approach", tradeoff: "A person chose between alternatives", override: "A person corrected the AI's proposal",
  "risk-accepted": "A person knowingly accepted a risk or debt", scope: "A person set or limited the scope", deferred: "A person intentionally postponed work",
};

export interface DecisionControls {
  decisions: Decision[]; enabled: boolean; busy: boolean; error: string;
  onCreate: (draft: HumanDecisionDraft) => Promise<void>;
  onEdit: (item: Decision, patch: Partial<HumanDecisionDraft> & { madeBy?: "human" | "agent" }) => Promise<void>;
  onConfirm: (item: Decision, confirmed: boolean) => Promise<void>;
  onStatus: (item: Decision, status: "active" | "superseded") => Promise<void>;
  onRemove: (item: Decision) => Promise<void>;
  describeAnchor: (anchor: DecisionAnchor) => string;
  onOpenAnchor?: (anchor: DecisionAnchor, item: Decision) => void;
  focus?: { decisionId: string };
}

const alternativesToText = (item?: Decision) => (item?.alternatives ?? []).map((alt) => alt.whyNot ? `${alt.option} — ${alt.whyNot}` : alt.option).join("\n");
const textToAlternatives = (value: string) => value.split("\n").map((row) => row.trim()).filter(Boolean).slice(0, 10).map((row) => {
  const [option, ...why] = row.split(/\s[—|]\s/);
  return { option: option.trim().slice(0, 500), whyNot: why.join(" — ").trim().slice(0, 2000) };
});
const field = "w-full";

/** A person's decision is just why, plus the alternatives they passed on; the title and kind are derived. */
export const titleFrom = (why: string) => {
  const line = why.trim().split("\n")[0].trim();
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
};
export const isPlain = (item: Decision) => item.title === titleFrom(item.decision) && !item.rationale;

export function DecisionComposer({ label, anchors, initial, busy, onSave, onCancel }: {
  label: string; anchors: DecisionAnchorInput[]; initial?: Decision; busy: boolean;
  onSave: (draft: HumanDecisionDraft) => Promise<void>; onCancel: () => void;
}) {
  const [why, setWhy] = useState(initial?.decision ?? ""), [alternatives, setAlternatives] = useState(alternativesToText(initial));
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  return <form className="question-composer decision-composer" aria-label={label} onSubmit={(event) => {
    event.preventDefault();
    setError(""); setSaving(true);
    const options = textToAlternatives(alternatives);
    // Keep a hand-written title and kind (agent records, older decisions); derive them for plain ones.
    const keepTitle = initial && !isPlain(initial);
    void onSave({ title: keepTitle ? initial.title : titleFrom(why), kind: initial && keepTitle ? initial.kind : options.length ? "tradeoff" : "direction", decision: why.trim(), rationale: initial?.rationale ?? "", alternatives: options, ...(initial?.revisitWhen ? { revisitWhen: initial.revisitWhen } : {}), anchors })
      .then(onCancel).catch((error: unknown) => setError(String(error))).finally(() => setSaving(false));
  }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
    <strong>{label}</strong>
    <label>Why<textarea autoFocus required rows={2} maxLength={20000} className={field} value={why} onChange={(event) => setWhy(event.target.value)} disabled={busy || saving} placeholder="Why this way?" /></label>
    <label>Alternatives<textarea rows={1} className={field} value={alternatives} onChange={(event) => setAlternatives(event.target.value)} disabled={busy || saving} placeholder="Other options you considered (optional, one per line)" /></label>
    <div className="question-actions">
      <button type="submit" className="primary" disabled={busy || saving || !why.trim()}>{busy || saving ? "Saving..." : initial ? "Save changes" : "Record decision"}</button>
      <button type="button" disabled={busy || saving} onClick={onCancel}>Cancel</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function DecisionBadge({ item }: { item: Decision }) {
  return <>
    <span className={`chip decision-who decision-${item.madeBy}`}>{item.madeBy === "human" ? "Human decision" : "Agent assumption"}</span>
    {!isPlain(item) && <span className="chip decision-kind" title={KIND_HELP[item.kind]}>{KIND_LABELS[item.kind]}</span>}
    {item.status === "superseded" ? <span className="chip decision-state">Superseded</span>
      : item.confirmed ? <span className="chip decision-state decision-confirmed">Confirmed</span>
      : needsConfirmation(item) && <span className="chip decision-state decision-pending">Needs confirmation</span>}
  </>;
}

export function DecisionCard({ item, controls, compact }: { item: Decision; controls: DecisionControls; compact?: boolean }) {
  const [editing, setEditing] = useState(false), [error, setError] = useState("");
  const run = (action: () => Promise<void>) => { setError(""); void action().catch((reason: unknown) => setError(String(reason))); };
  const disabled = !controls.enabled || controls.busy;
  return <article className={`question-thread decision-card decision-card-${item.madeBy}${item.status === "superseded" ? " decision-superseded" : ""}`} id={`decision-${item.id}`} tabIndex={-1} aria-label={`Decision: ${item.title}`}>
    <header><DecisionBadge item={item} /></header>
    {!isPlain(item) && <h4 className="decision-title">{item.title}</h4>}
    <ReportMarkdown config={{ text: item.decision }} />
    {!compact && item.rationale && <div className="decision-rationale"><h5>Why</h5><ReportMarkdown config={{ text: item.rationale }} /></div>}
    {!compact && !!item.alternatives.length && <div className="decision-alternatives"><h5>Alternatives</h5><ul>{item.alternatives.map((alt, index) => <li key={index}><b>{alt.option}</b>{alt.whyNot && <> — {alt.whyNot}</>}</li>)}</ul></div>}
    {item.source.quote && <blockquote className="decision-quote"><span className="loc">{item.source.kind === "chat" ? "Said in the chat" : item.source.kind === "review" ? "From review" : "Source"}:</span> “{item.source.quote}”</blockquote>}
    {item.source.note && !compact && <p className="loc">{item.source.note}</p>}
    {!compact && item.revisitWhen && <p className="decision-revisit"><b>Revisit when:</b> {item.revisitWhen}</p>}
    {!!item.anchors.length && <ul className="decision-anchors" aria-label="Applies to">{item.anchors.map((anchor, index) => <li key={index}>
      {controls.onOpenAnchor ? <button type="button" onClick={() => controls.onOpenAnchor!(anchor, item)}>{controls.describeAnchor(anchor)}</button> : <span className="loc">{controls.describeAnchor(anchor)}</span>}
    </li>)}</ul>}
    <p className="loc decision-meta">Recorded by {item.recordedBy === "agent" ? `${item.agent ?? "an agent"} (agent)` : "you"}{item.confirmed ? " · confirmed by the reviewer" : ""}</p>
    <div className="question-actions">
      {!item.confirmed && needsConfirmation(item) && <button type="button" className="primary" disabled={disabled} onClick={() => run(() => controls.onConfirm(item, true))}>{item.madeBy === "agent" ? "Confirm assumption" : "Confirm"}</button>}
      {item.madeBy === "agent" && item.status === "active" && <button type="button" disabled={disabled} onClick={() => run(() => controls.onEdit(item, { madeBy: "human" }))}>Adopt as my decision</button>}
      <button type="button" disabled={disabled} onClick={() => setEditing(true)}>Edit</button>
      <button type="button" disabled={disabled} onClick={() => run(() => controls.onStatus(item, item.status === "active" ? "superseded" : "active"))}>{item.status === "active" ? "Mark superseded" : "Restore"}</button>
      <button type="button" disabled={disabled} onClick={() => run(async () => { if (await reportServices.ask("Delete this decision?", { title: "Delete decision", kind: "warning" })) await controls.onRemove(item); })}>Delete</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {editing && <DecisionComposer label="Edit decision" anchors={[]} initial={item} busy={controls.busy} onSave={(draft) => controls.onEdit(item, { title: draft.title, kind: draft.kind, decision: draft.decision, alternatives: draft.alternatives })} onCancel={() => setEditing(false)} />}
  </article>;
}

/** Decisions recorded against one diagram node, shown in that node's drawer, with a control to record another. */
export function NodeDecisions({ diagramId, nodeId, controls }: { diagramId: string; nodeId: string; controls: DecisionControls }) {
  const [recording, setRecording] = useState(false);
  const items = controls.decisions.filter((item) => item.status === "active" && item.anchors.some((anchor) => anchor.type === "node" && anchor.diagramId === diagramId && anchor.nodeId === nodeId));
  return <section className="node-decisions" aria-label="Decisions on this step">
    <div className="file-decisions-head"><h3>Decisions on this step</h3>
      <button type="button" disabled={!controls.enabled || controls.busy} onClick={() => setRecording(true)}>Record a decision</button></div>
    {items.map((item) => <DecisionCard key={item.id} item={item} controls={controls} />)}
    {!items.length && !recording && <p className="loc">No judgement calls are recorded for this step.</p>}
    {recording && <DecisionComposer label="Decision on this step" busy={controls.busy} anchors={[{ type: "node", diagramId, nodeId }]} onSave={controls.onCreate} onCancel={() => setRecording(false)} />}
  </section>;
}

export function nodeDecisionCount(controls: DecisionControls | undefined, diagramId: string, nodeId: string) {
  return controls?.decisions.filter((item) => item.status === "active" && item.anchors.some((anchor) => anchor.type === "node" && anchor.diagramId === diagramId && anchor.nodeId === nodeId)).length ?? 0;
}
