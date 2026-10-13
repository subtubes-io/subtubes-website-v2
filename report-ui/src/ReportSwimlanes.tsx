"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Scale } from "lucide-react";
import { NodeDecisions, nodeDecisionCount, type DecisionControls } from "./Decisions";
import type { DesignContent } from "./model/designs";
import type { ReportSwimlane } from "./model/report-swimlanes";
import { DesignCanvas, type DesignSelection } from "./DesignCanvas";
import { designLayout, isVertical, setLaneOrientation } from "./design-layout";
import { ReportMarkdown } from "./ReportMarkdown";
import { DesignPicker } from "./DesignPicker";
import { reportServices } from "./services";

type SaveLayout = (id: string, content: DesignContent) => Promise<void>;
interface Props {
  diagrams: ReportSwimlane[]; onSaveLayout?: SaveLayout; files?: readonly string[]; onOpenFile?: (path: string) => void; decisions?: DecisionControls; focusDiagramId?: string;
  /** Copies a saved design into the report as a frozen snapshot; absent when the report is not saved to a project. */
  onAttach?: (designId: string) => Promise<void>; onRemove?: (diagramId: string) => Promise<void>;
}
function Diagram({ diagram, onSaveLayout, files = [], onOpenFile, decisions, overlay, directionSlot }: Omit<Props, "diagrams" | "focusDiagramId"> & { diagram: ReportSwimlane; overlay: RefObject<HTMLDivElement | null>; directionSlot: HTMLElement | null }) {
  const [selection, setSelection] = useState<DesignSelection>();
  const [details, setDetails] = useState<DesignSelection>();
  const [content, setContent] = useState(diagram.content);
  const latest = useRef(content);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false), again = useRef(false);
  const [error, setError] = useState("");
  // A change made while a save is running is saved right after it, so no edit is dropped.
  const persist = async (): Promise<void> => {
    if (!onSaveLayout) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true; setSaving(true); setError("");
    let failed = false;
    try { await onSaveLayout(diagram.id, latest.current); }
    catch (error) { failed = true; console.error("Swimlane layout save failed", error); setError(`Could not save layout: ${String(error)}. Reopen the report if it changed elsewhere, or retry saving.`); }
    finally { busy.current = false; setSaving(false); }
    // Let the saved report reach the page before saving again, so the next save starts from it.
    if (again.current && !failed) { again.current = false; await new Promise((resolve) => setTimeout(resolve, 0)); await persist(); } else again.current = false;
  };
  // Flips the lanes between rows and columns; the legend follows to the open side of the new layout.
  const flip = (orientation: "horizontal" | "vertical") => {
    if (!onSaveLayout || saving || error) return;
    let next = setLaneOrientation(latest.current, orientation);
    if (next === latest.current) return;
    if (next.legend) next = { ...next, legend: { ...next.legend, x: Math.min(20000, designLayout({ ...next, legend: undefined }).width + 40), y: 40 } };
    latest.current = next; setContent(next); void persist();
  };
  const swimlane = diagram.content.kind === "swimlane";
  const canFlip = !!onSaveLayout && swimlane && !saving && !error;
  const vertical = isVertical(content);
  const selected = details?.kind === "group" ? content.groups.find(group => group.id === details.id) : undefined;
  const link = details?.kind === "link" ? content.links.find(link => link.id === details.id) : undefined;
  const fileRefs = (item: { fileRefs?: { file: string; line?: number }[] }, close?: () => void) => !!item.fileRefs?.length && <div aria-label="Referenced files">{item.fileRefs.map((ref, index) => <div key={index}>
    {files.includes(ref.file) && onOpenFile ? <button type="button" className="report-design-link" onClick={() => { close?.(); onOpenFile(ref.file); }}>{ref.file}{ref.line ? `:${ref.line}` : ""}</button>
      : <span className="loc">{ref.file}{ref.line ? `:${ref.line}` : ""} — No saved diff available</span>}
  </div>)}</div>;
  return <>
    {directionSlot && swimlane && createPortal(<div className="tabs" role="group" aria-label="Lane direction" title={onSaveLayout ? undefined : "Save the report to a project to change its layout"}>
      <button type="button" aria-pressed={!vertical} disabled={!canFlip} onClick={() => flip("horizontal")}>Horizontal</button>
      <button type="button" aria-pressed={vertical} disabled={!canFlip} onClick={() => flip("vertical")}>Vertical</button>
    </div>, directionSlot)}
    {saving && <p role="status" className="loc">Saving layout...</p>}
    {error && <div role="alert" className="report-swimlane-error">{error} <button disabled={saving} onClick={() => void persist()}>Retry saving layout</button></div>}
    <div className="report-swimlane-layout">
      <DesignCanvas config={{
        content, selection, readOnly: true, overlay, designId: diagram.id, designIdLabel: "diagram ID",
        layout: onSaveLayout && swimlane ? {
          disabled: saving || !!error,
          onMove: (kind, id, x, y) => {
            const next = kind === "node" ? { ...latest.current, nodes: latest.current.nodes.map(node => node.id === id ? { ...node, x, y } : node) }
              : { ...latest.current, legend: latest.current.legend && { ...latest.current.legend, x, y } };
            latest.current = next; setContent(next);
          },
          onResize: next => { latest.current = next; setContent(next); },
          onEnd: () => void persist(),
        } : undefined,
        onSelect: setSelection, onNode: id => setSelection({ kind: "node", id }),
        onOpen: item => { setSelection(item); setDetails(item); },
        renderComment: text => <ReportMarkdown config={{ text, files, onOpenFile }} />,
        renderNodeExtras: (id, close) => { const node = content.nodes.find(item => item.id === id); return node && <>{fileRefs(node, close)}{decisions && <NodeDecisions diagramId={diagram.id} nodeId={id} controls={decisions} />}</>; },
        renderNodeBadge: id => { const count = nodeDecisionCount(decisions, diagram.id, id); return count ? <i className="design-node-decisions" role="img" aria-label={`${count} ${count === 1 ? "decision" : "decisions"}`} title={`${count} recorded ${count === 1 ? "decision" : "decisions"}`}><Scale size={13} aria-hidden="true" />{count}</i> : null; },
      }} />
      {(selected || link) && <aside className="report-swimlane-details" aria-label="Swimlane details">
        <button type="button" onClick={() => setDetails(undefined)} aria-label="Close swimlane details">Close</button>
        <h3>{selected?.title ?? "Connection"}</h3>
        {selected && fileRefs(selected)}
        <ReportMarkdown config={{ text: selected?.comment ?? link?.label ?? "", files, onOpenFile }} />
      </aside>}
    </div>
    {!content.nodes.length && <p className="loc">This saved diagram has no steps.</p>}
  </>;
}

const dated = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

/** Which design a report diagram is a copy of, and whether that design has moved on since the copy was taken. */
function Provenance({ diagram, latest, onRemove }: { diagram: ReportSwimlane; latest?: Map<string, number>; onRemove?: () => void }) {
  const source = diagram.source, current = source && latest?.get(source.designId);
  return <div className="report-diagram-source" aria-label="Diagram source">
    {source
      ? <span><b>{source.name}</b> · taken {dated(source.snapshotAt)}.
        {latest && (current === undefined ? " The original design has been deleted." : current > source.revision ? " The design has changed since; add it again to take a new snapshot." : "")}</span>
      : <span>Drawn by the coding agent when the report was generated.</span>}
    {onRemove && <button type="button" onClick={onRemove}>Remove from report</button>}
  </div>;
}

export function ReportSwimlanes({ diagrams, onSaveLayout, files, onOpenFile, decisions, focusDiagramId, onAttach, onRemove }: Props) {
  const [id, setId] = useState(diagrams[0]?.id), [picking, setPicking] = useState(false), [problem, setProblem] = useState("");
  useEffect(() => { if (focusDiagramId && diagrams.some(diagram => diagram.id === focusDiagramId)) setId(focusDiagramId); }, [focusDiagramId, diagrams]);
  const toolbar = useRef<HTMLDivElement>(null);
  const [directionSlot, setDirectionSlot] = useState<HTMLElement | null>(null);
  const [latest, setLatest] = useState<Map<string, number>>();
  const hasSources = diagrams.some(diagram => diagram.source);
  useEffect(() => {
    if (!hasSources || !onAttach) return;
    let current = true;
    reportServices.designs({ action: "list" }).then(result => { if (current) setLatest(new Map(result.designs.map(design => [design.id, design.revision]))); }, () => undefined);
    return () => { current = false; };
  }, [hasSources, onAttach, diagrams]);
  const active = diagrams.find(diagram => diagram.id === id) ?? diagrams[0];
  const remove = async (diagram: ReportSwimlane) => {
    if (!onRemove) return;
    setProblem("");
    try { if (await reportServices.ask(`Remove "${diagram.content.name}" from this report?`, { title: "Remove diagram", kind: "warning" })) await onRemove(diagram.id); }
    catch (cause) { setProblem(String(cause instanceof Error ? cause.message : cause)); }
  };
  const picker = picking && onAttach && <DesignPicker attached={diagrams} onAdd={onAttach} onClose={() => setPicking(false)} />;
  if (!active) return <section className="empty report-swimlanes-empty" aria-label="Report diagrams">
    <h3>No design is attached to this report</h3>
    <p>A report shows the design it was built from. Create a swimlane or system design in Designs, iterate on it with your coding agent while building the feature, then pick it here. The report keeps a frozen copy, so later edits to the design never change it.</p>
    <p><button type="button" className="primary" disabled={!onAttach} title={onAttach ? undefined : "Save the report to a project to add designs"} onClick={() => setPicking(true)}>Pick a design</button></p>
    {picker}
  </section>;
  return <section className="report-swimlanes designs-workspace" aria-label="Report diagrams">
    <div ref={toolbar} className="report-swimlane-toolbar">
      {diagrams.length > 1 && <div className="tabs" role="group" aria-label="Diagrams">
        {diagrams.map(diagram => <button type="button" key={diagram.id} aria-pressed={active.id === diagram.id} onClick={() => setId(diagram.id)}>{diagram.content.name}</button>)}
      </div>}
      <span ref={setDirectionSlot} className="report-swimlane-direction" />
      <div className="tabs"><button type="button" disabled={!onAttach} title={onAttach ? undefined : "Save the report to a project to add designs"} onClick={() => setPicking(true)}>Add design</button></div>
      <Provenance diagram={active} latest={latest} onRemove={onRemove ? () => void remove(active) : undefined} />
      {problem && <p role="alert" className="report-diagram-problem">{problem}</p>}
    </div>
    {picker}
    <Diagram key={active.id} diagram={active} onSaveLayout={onSaveLayout} files={files} onOpenFile={onOpenFile} decisions={decisions} overlay={toolbar} directionSlot={directionSlot} />
  </section>;
}
