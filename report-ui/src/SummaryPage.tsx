"use client";
import { useId } from "react";
import type { DesignRef, Report } from "./model/types";
import type { ReportTab } from "./ReportTabs";
import { FlagRow } from "./DiffView";
import { EditableText } from "./EditableText";
import { StepThumbnail } from "./WalkthroughCarousel";
import { ReportMarkdown } from "./ReportMarkdown";
import { DesignRefs } from "./DesignRefs";
import { JudgementCalls } from "./JudgementCalls";
import type { DecisionControls } from "./Decisions";
import type { QaWalkthrough } from "./model/qa";
import { qaSummary, WalkthroughView } from "./QaPage";

const noSave = () => Promise.reject(new Error("This report cannot be edited."));

export function SummaryPage({ config }: { config: {
  report: Report; onFile: (file: string) => void;
  onView: (view: ReportTab) => void;
  onOpenDesign?: (ref: DesignRef) => void;
  /** The judgement calls with their controls; omitted when decisions cannot be shown. */
  judgement?: DecisionControls;
  /** Opens one of the report's attached diagrams on the Design page. */
  onOpenDiagram?: (diagramId: string) => void;
  /** Saves wording a person changed in place; omitted (or disabled) when the report cannot be edited. */
  edit?: { enabled: boolean; onTitle: (text: string) => Promise<void>; onNarrative: (text: string) => Promise<void>; onGroup: (index: number, text: string) => Promise<void>; onFlag: (index: number, text: string) => Promise<void> };
  qa?: QaWalkthrough[];
  /** Offers the way to attach a design when the report has none; omitted when designs cannot be attached (a frozen or read-only report). */
  canAttachDesign?: boolean;
} }) {
  const { report, onFile, onView, edit } = config;
  const id = useId();
  const labels = { feature: "Feature", refactor: "Refactor", tests: "Tests", security: "Security", config: "Configuration", deps: "Dependencies", docs: "Documentation" };
  const files = new Set(report.files.map((file) => file.path));
  const approved = new Set(report.files.filter((file) => file.reviewed === true).map((file) => file.path));
  return <section className="summary-page" aria-label="Report summary">
    <div id="sheetbody">
      <div className="review-page-heading"><div><h3>Review overview</h3><EditableText label="Title" single enabled={!!edit?.enabled} value={report.title ?? ""} onSave={edit?.onTitle ?? noSave} className="editable-title"><h2>{report.title || "Untitled review"}</h2></EditableText></div><span className="chip">{report.source === "agent" ? "Agent-authored" : "Heuristic draft"}</span></div>
      <div className="summary-dashboard">
        <div className="summary-main">
        <section className="summary-overview" aria-label="Intent">
          <h3>Intent</h3>
          <EditableText label="Intent" enabled={!!edit?.enabled} value={report.narrative} onSave={edit?.onNarrative ?? noSave} placeholder="What does this change set out to do?">
            {report.narrative ? <ReportMarkdown config={{ text: report.narrative, onOpenDesign: config.onOpenDesign }} /> : <p className="loc">No intent was provided.{edit?.enabled ? " Double-click to write it." : ""}</p>}
          </EditableText>
        </section>
        <section className="summary-section" aria-label="Designs">
          <h3>Designs</h3>
          {report.swimlanes?.length ? <div className="design-cards">
            {report.swimlanes.map((diagram) => <button type="button" className="design-card" key={diagram.id} onClick={() => config.onOpenDiagram?.(diagram.id)} disabled={!config.onOpenDiagram}
              aria-label={`Open design ${diagram.content.name}`}>
              {diagram.preview && <span className="design-card-preview"><StepThumbnail hash={diagram.preview} alt={`Preview of ${diagram.content.name}`} /></span>}
              <span className="design-card-kind">{diagram.content.kind === "system" ? "System design" : "Swimlane flow"}</span>
              <strong>{diagram.content.name}</strong>
              <span className="loc">{diagram.content.nodes.length} {diagram.content.nodes.length === 1 ? "step" : "steps"}{diagram.source ? ` · snapshot of revision ${diagram.source.revision}` : ""}</span>
              {diagram.content.description && <span className="design-card-text">{diagram.content.description.replace(/[*_`#>]/g, "")}</span>}
            </button>)}
          </div> : <>
            <p className="loc">No designs are attached to this report yet.</p>
            {config.canAttachDesign && <div className="summary-judgement-actions"><button type="button" onClick={() => onView("design")}>Attach a design</button></div>}
          </>}
        </section>
        <section className="summary-section" aria-label="Change intentions">
          <h3>Change intentions</h3><div className="summary-cards">
            {report.groups.map((group, index) => <article className="summary-card" key={index} aria-labelledby={`${id}-${index}`}>
              <h4 id={`${id}-${index}`}><span className="summary-number">{index + 1}</span>{labels[group.kind]}</h4><EditableText label={`Change intention ${index + 1}`} enabled={!!edit?.enabled} value={group.summary} onSave={(value) => (edit?.onGroup ?? noSave)(index, value)}><ReportMarkdown config={{ text: group.summary, onOpenDesign: config.onOpenDesign }} /></EditableText>
              {group.files.length ? <details className="summary-files-details"><summary>{group.files.length} affected file{group.files.length === 1 ? "" : "s"}</summary><ul className="summary-files">{group.files.map((file, i) => <li key={i}>
                <button type="button" className="summary-file" data-file={file} title={files.has(file) ? `View diff for ${file}` : `No saved diff for ${file}`} onClick={() => onFile(file)}>{file}</button>
                {approved.has(file) ? <span className="file-approved">Approved</span> : !files.has(file) && <span className="loc">No saved diff</span>}
              </li>)}</ul></details> : null}
            </article>)}
            {!report.groups.length && <p className="loc">No change intentions were provided for this report.</p>}
          </div>
        </section>
        {config.judgement && <JudgementCalls controls={config.judgement} />}
        <section className="summary-section summary-qa" aria-label="QA evidence">
          <h3>QA</h3>
          {config.qa?.length ? config.qa.map((walkthrough) => <div className="summary-walkthrough" key={walkthrough.id} role="group" aria-label={`QA walkthrough: ${walkthrough.title}`}>
            <h4>{walkthrough.title}</h4>
            <p className="loc">{qaSummary(walkthrough.steps)}</p>
            {walkthrough.steps.length ? <WalkthroughView walkthrough={walkthrough} files={[...files]} onOpenFile={onFile} /> : <p className="loc">No steps in this walkthrough yet.</p>}
          </div>) : <>
            <p className="loc">No QA walkthroughs yet. Build one in the QA tab with screenshots and notes that show how the change was exercised.</p>
            <div className="summary-judgement-actions"><button type="button" onClick={() => onView("qa")}>Build a walkthrough</button></div>
          </>}
        </section>
        </div>
        <div className="summary-sidebar">
          {!!report.designRefs?.length && <DesignRefs config={{ refs: report.designRefs, onOpenDesign: config.onOpenDesign }} />}
          <section className="summary-section summary-findings" aria-label="Review flags"><h3>Flags ({report.flags.length})</h3>
            {report.flags.length ? report.flags.map((flag, index) => <FlagRow key={index} flag={flag} onSelect={() => onFile(flag.file)} edit={edit ? { enabled: edit.enabled, onSave: (value) => edit.onFlag(index, value) } : undefined} />) : <><p>No flags were reported.</p><p className="loc">This is not a guarantee that the change is safe.</p></>}
          </section>
        </div>
      </div>
      <div className="loc summary-meta">{report.base} → {report.head}{report.repoRoot && <div>{report.repoRoot}</div>}</div>
    </div>
  </section>;
}
