"use client";
import type { Dispatch, SetStateAction } from "react";
import type { DesignRef, Report } from "./model/types";
import { DiffView } from "./DiffView";
import type { DiffLayout } from "./diffrows";
import { FileTree, type TreeState } from "./FileTree";
import { DecisionCard, DecisionComposer, type DecisionControls } from "./Decisions";
import { useState } from "react";
import { ReportMarkdown } from "./ReportMarkdown";
import { DesignRefs } from "./DesignRefs";
import { EXPOSURE, WEAKENED } from "./risk-labels";

export interface FileReviewConfig {
  report: Report; file: string; onFile: (path: string) => void;
  tree: TreeState; setTree: Dispatch<SetStateAction<TreeState>>;
  layout: DiffLayout; onLayout: (layout: DiffLayout) => void;
  approval: { enabled: boolean; saving: boolean; error: string; onChange: (reviewed: boolean) => void };
  decisions?: DecisionControls;
  onOpenDesign?: (ref: DesignRef) => void;
}

export function FileReview({ config }: { config: FileReviewConfig }) {
  const { report, file: path, onFile, tree, setTree, layout, onLayout, approval } = config;
  const file = report.files.find((entry) => entry.path === path);
  const groups = report.groups.filter((group) => group.files.includes(path));
  const reach = report.risk?.files.find((entry) => entry.file === path && entry.analyzed && !entry.deleted);
  const fileSensitive = (report.risk?.sensitive ?? []).filter((item) => item.file === path);
  const fileWeakened = (report.risk?.tests.weakened ?? []).filter((item) => item.file === path);
  const [recording, setRecording] = useState(false);
  const decisions = config.decisions;
  const fileDecisions = (decisions?.decisions ?? []).filter((item) => item.status === "active" && item.anchors.some((anchor) => anchor.type === "file" && anchor.file === path));
  const decisionCounts = new Map<string, number>();
  for (const item of decisions?.decisions ?? []) if (item.status === "active") for (const file of new Set(item.anchors.flatMap((anchor) => anchor.type === "file" ? [anchor.file] : anchor.type === "line" ? [anchor.anchor.file] : []))) decisionCounts.set(file, (decisionCounts.get(file) ?? 0) + 1);
  return <div className="file-review-workspace">
    <aside className="file-review-tree" aria-label="Diff file navigator">
      <FileTree config={{ files: report.files, selected: path, state: tree, setState: setTree, onSelect: onFile, decisionCounts }} />
    </aside>
    <section className="file-review-content" aria-label="File review">
      {file && <div className="file-approval">
        <label><input type="checkbox" role="switch" checked={file.reviewed === true} disabled={approval.saving || !approval.enabled} onChange={(event) => approval.onChange(event.target.checked)} /><span className="approval-switch-track" aria-hidden="true" />Reviewed and approved</label>
        <span className="loc" role="status">{approval.saving ? "Saving approval..." : !approval.enabled ? "Save this report to a project first" : file.reviewed === true ? "Approval saved to report" : "Not yet approved"}</span>
        <span className="loc">Applies to the entire file</span>
        {approval.error && <span role="alert">{approval.error}</span>}
      </div>}
      {(reach || fileSensitive.length > 0 || fileWeakened.length > 0) && <section className="file-facts" aria-label="Facts about this file">
        {reach && <span>Reach: {reach.direct} direct and {reach.transitive} total {reach.transitive === 1 ? "dependent" : "dependents"}{reach.role === "test" ? " · this is a test file" : reach.tests.length ? ` · ${reach.tests.length} test ${reach.tests.length === 1 ? "file imports" : "files import"} it` : " · no test imports it"}</span>}
        {(fileSensitive.length > 0 || fileWeakened.length > 0) && <ul>
          {fileSensitive.map((item, index) => <li key={`s${index}`}><span className={`chip st risk-sev-${item.severity}`}>{item.severity}</span><span><b>{item.message}</b> · line {item.line} · {EXPOSURE[item.exposure]}</span></li>)}
          {fileWeakened.map((item, index) => <li key={`w${index}`}><span className="chip st risk-sev-medium">test</span><span><b>{WEAKENED[item.kind]}</b>{item.line ? ` · line ${item.line}` : ""} · {item.detail}</span></li>)}
        </ul>}
      </section>}
      <section className="change-context" aria-label="Change description">
        <h3>Change description</h3>
        {!!groups.length && <div className="change-intentions"><h4>Why this file changed</h4>{groups.map((group, index) => <ReportMarkdown key={index} config={{ text: group.summary, onOpenDesign: config.onOpenDesign }} />)}</div>}
        {!groups.length && <p className="loc">No file-specific change description was provided in this report.</p>}
        {report.narrative && <details className="change-report-context"><summary>Report context</summary><ReportMarkdown config={{ text: report.narrative, onOpenDesign: config.onOpenDesign }} /></details>}
        {!!report.designRefs?.length && <DesignRefs config={{ refs: report.designRefs, onOpenDesign: config.onOpenDesign }} />}
      </section>
      {decisions && file && <section className="file-decisions-block" aria-label="File decisions">
        <div className="file-decisions-head"><h3>Decisions on this file</h3>
          <button type="button" disabled={!decisions.enabled || decisions.busy} onClick={() => setRecording(true)}>Record a decision</button></div>
        {fileDecisions.map((item) => <DecisionCard key={item.id} item={item} controls={decisions} />)}
        {!fileDecisions.length && !recording && <p className="loc">No file-level decisions. Line-level decisions appear in the diff below.</p>}
        {recording && <DecisionComposer label="Decision on this file" busy={decisions.busy} anchors={[{ type: "file", file: path }]} onSave={decisions.onCreate} onCancel={() => setRecording(false)} />}
      </section>}
      <div className="detail-diff"><DiffView key={path} config={{ file, flags: report.flags, layout, onLayout, decisions: config.decisions }} /></div>
      {!file && <p className="loc">No saved diff is available for this file. Select a changed file to review its diff.</p>}
    </section>
  </div>;
}
