"use client";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DesignRef, Report, SnapshotMeta } from "./model/types";
import type { TreeState } from "./FileTree";
import type { FileReviewConfig } from "./FileReview";
import { NodeDetails } from "./NodeDetails";
import type { DiffLayout } from "./diffrows";
import { SummaryPage } from "./SummaryPage";
import { ReportTabs, type ReportTab } from "./ReportTabs";
import { ChangesPage } from "./ChangesPage";
import type { ReportScope } from "./report-scope";
import type { DecisionControls } from "./Decisions";
import { useDecisions } from "./useDecisions";
import { useReportText } from "./useReportText";
import { useDiagramPreviews } from "./useDiagramPreviews";
import { useQa } from "./useQa";
import { QaPage, type QaControls } from "./QaPage";
import { walkthroughsOf, type QaStep } from "./model/qa";
import type { Decision, DecisionAnchor } from "./model/decisions";
import { ReportSwimlanes } from "./ReportSwimlanes";
import type { DesignContent } from "./model/designs";

let sessionLayout: DiffLayout = "split";
export function Review({ config }: { config: {
  report: Report; snapshot: SnapshotMeta; notify: (message: string) => void;
  onSave: () => void; onReports: () => void;
  onSaveSwimlaneLayout?: (diagramId: string, content: DesignContent) => Promise<void>;
  /** Copies a saved design into the report as a frozen snapshot, or removes a diagram from it. */
  onAttachDesign?: (designId: string) => Promise<void>; onRemoveDiagram?: (diagramId: string) => Promise<void>;
  onApproveFile?: (path: string, reviewed: boolean) => Promise<void>;
  reportScope?: ReportScope;
  menuHost?: HTMLElement | null;
  onOpenDesign?: (ref: DesignRef) => void;
  /** Controls shown at the end of the report menu, and a notice shown above the report. */
  menuExtras?: ReactNode; notice?: ReactNode;
  /** Kept mounted but out of sight (while a snapshot is open), so the live report is exactly as it was left. */
  inactive?: boolean;
} }) {
  const { snapshot, notify, onSave, onReports, onApproveFile } = config;
  const text = useReportText(config.reportScope, config.report);
  const previews = useDiagramPreviews(config.reportScope, text.report.swimlanes ?? [], !config.inactive);
  const report = useMemo(() => (Object.keys(previews).length ? { ...text.report, swimlanes: text.report.swimlanes?.map((diagram) => (diagram.preview || !previews[diagram.id] ? diagram : { ...diagram, preview: previews[diagram.id] })) } : text.report), [text.report, previews]);
  const [tab, setTab] = useState<ReportTab>("summary");
  const [file, setFile] = useState(report.files[0]?.path ?? "");
  const [tree, setTree] = useState<TreeState>({ query: "", collapsed: new Set() });
  const [layout, setLayout] = useState(sessionLayout);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [decisionFocus, setDecisionFocus] = useState<DecisionControls["focus"]>();
  const [diagramFocus, setDiagramFocus] = useState<string>();
  const decisions = useDecisions(config.reportScope, report.decisions ?? [], notify);
  const qa = useQa(config.reportScope, walkthroughsOf(report), notify);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const restoreReviewFocus = useRef(false);
  const toolbarHost = useRef<HTMLDivElement>(null);
  const focusTab = useRef<ReportTab | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const approvalBusy = useRef(false);
  const [approvalError, setApprovalError] = useState<{ path: string; message: string }>();
  const activeFile = report.files.find((entry) => entry.path === file);
  const approve = (reviewed: boolean) => {
    if (!onApproveFile || !snapshot.id || !activeFile || approvalBusy.current) return;
    const path = activeFile.path;
    approvalBusy.current = true; setSavingApproval(true); setApprovalError(undefined);
    void onApproveFile(path, reviewed).catch((error: unknown) => {
      console.error(error); setApprovalError({ path, message: `Could not save file approval: ${String(error)}` });
      notify(`Could not save file approval: ${String(error)}`);
    }).finally(() => { approvalBusy.current = false; setSavingApproval(false); });
  };
  const showFile = (path: string) => {
    if (!report.files.some((f) => f.path === path)) { notify(`No diff is available for ${path} in this report.`); return; }
    // From the diagrams a file opens in the node drawer, beside the step that explains it; from anywhere else the diff is its own chapter.
    const peek = tab === "design";
    if (peek) reviewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFile(path); setReviewOpen(peek); setApprovalError(undefined); setDecisionFocus(undefined);
    if (!peek) setTab("changes");
    setTree((old) => ({ query: "", collapsed: new Set([...old.collapsed].filter((folder) => !path.startsWith(folder))) }));
  };
  const showView = (view: ReportTab) => {
    setTab(view); setReviewOpen(false);
    // Only ask for focus when the screen will change; otherwise the request would wait for an unrelated later render.
    if (view !== tab || reviewOpen) focusTab.current = view;
  };
  useLayoutEffect(() => {
    if (restoreReviewFocus.current && !reviewOpen) { reviewTrigger.current?.focus({ preventScroll: true }); restoreReviewFocus.current = false; }
    if (focusTab.current) { toolbarHost.current?.querySelector<HTMLButtonElement>(`[data-t="${focusTab.current}"]`)?.focus({ preventScroll: true }); focusTab.current = null; }
  });
  const changeLayout = (value: DiffLayout) => { sessionLayout = value; setLayout(value); };
  const selectFile = (path: string) => { setFile(path); setApprovalError(undefined); setDecisionFocus(undefined); };
  const closeReview = () => { restoreReviewFocus.current = true; setReviewOpen(false); };
  const diagramName = (diagramId: string) => report.swimlanes?.find((diagram) => diagram.id === diagramId)?.content.name ?? diagramId;
  const stepsOf = (walkthroughs: { id: string; steps: QaStep[] }[], id: string) => walkthroughs.find((item) => item.id === id)?.steps ?? [];
  const qaControls: QaControls = {
    walkthroughs: qa.walkthroughs, enabled: qa.enabled, busy: qa.busy, error: qa.error,
    onAddWalkthrough: async (title) => (await qa.mutate({ action: "addWalkthrough", title })).walkthroughs,
    onRenameWalkthrough: async (walkthrough, title) => { await qa.mutate({ action: "renameWalkthrough", walkthroughId: walkthrough.id, expectedRevision: walkthrough.revision, title }); },
    onRemoveWalkthrough: async (walkthrough) => { await qa.mutate({ action: "removeWalkthrough", walkthroughId: walkthrough.id, expectedRevision: walkthrough.revision }); },
    onAdd: async (walkthrough, input) => stepsOf((await qa.mutate({ action: "add", walkthroughId: walkthrough.id, ...input })).walkthroughs, walkthrough.id),
    onEdit: async (walkthrough, step, patch) => { await qa.mutate({ action: "edit", walkthroughId: walkthrough.id, stepId: step.id, expectedRevision: step.revision, ...patch }); },
    onMove: async (walkthrough, step, toIndex) => { await qa.mutate({ action: "move", walkthroughId: walkthrough.id, stepId: step.id, expectedRevision: step.revision, toIndex }); },
    onRemove: async (walkthrough, step) => { await qa.mutate({ action: "remove", walkthroughId: walkthrough.id, stepId: step.id, expectedRevision: step.revision }); },
  };
  const decisionControls: DecisionControls = {
    decisions: decisions.decisions, enabled: decisions.enabled, busy: decisions.busy, error: decisions.error, focus: decisionFocus,
    onCreate: async (draft) => { await decisions.mutate({ action: "create", ...draft }); },
    onEdit: async (item, patch) => { await decisions.mutate({ action: "edit", decisionId: item.id, ...patch }); },
    onConfirm: async (item, confirmed) => { await decisions.mutate({ action: "confirm", decisionId: item.id, confirmed }); },
    onStatus: async (item, status) => { await decisions.mutate({ action: "setStatus", decisionId: item.id, status }); },
    onRemove: async (item) => { await decisions.mutate({ action: "remove", decisionId: item.id }); },
    describeAnchor: (anchor: DecisionAnchor) => anchor.type === "line" ? `${anchor.anchor.path}:${anchor.anchor.line} · ${anchor.anchor.side === "old" ? "Before" : "After"}`
      : anchor.type === "file" ? anchor.file : `${diagramName(anchor.diagramId)} · ${report.swimlanes?.find((diagram) => diagram.id === anchor.diagramId)?.content.nodes.find((node) => node.id === anchor.nodeId)?.title ?? anchor.nodeId}`,
    onOpenAnchor: (anchor: DecisionAnchor, item: Decision) => {
      if (anchor.type === "node") { setDiagramFocus(anchor.diagramId); showView("design"); return; }
      showFile(anchor.type === "line" ? anchor.anchor.file : anchor.file);
      if (anchor.type === "line") setDecisionFocus({ decisionId: item.id });
    },
  };
  const fileReview: FileReviewConfig = {
    onOpenDesign: config.onOpenDesign,
    report, file, onFile: selectFile, tree, setTree, layout, onLayout: changeLayout,
    approval: { enabled: !!snapshot.id && !!onApproveFile, saving: savingApproval, error: approvalError?.path === file ? approvalError.message : "", onChange: approve },
    decisions: decisionControls,
  };
  const toolbar = <div className="review-toolbar" ref={toolbarHost}>
        <ReportTabs config={{ active: tab, onSelect: showView }} />
        {config.menuExtras}
      </div>;
  return <>
    {!config.inactive && (config.menuHost ? createPortal(toolbar, config.menuHost) : toolbar)}
    <div className="narrative" hidden={snapshot.id !== "" || config.inactive}><div className="banner">Pasted report (not saved)<button className="sec" onClick={onSave}>Save to project</button><button onClick={onReports}>Reports list</button></div></div>
    {config.notice}
    <main className={`report-view ${tab === "design" ? "canvas-view" : ""}${tab === "changes" ? " changes-view" : ""}`} style={config.inactive ? { display: "none" } : undefined} inert={config.inactive}>
      <section className="view" id="view" inert={reviewOpen}>
        <div id="body">
          {tab === "summary" && <SummaryPage config={{ report, onFile: showFile, onView: showView, onOpenDesign: config.onOpenDesign, qa: qa.walkthroughs,
            edit: { enabled: text.enabled, onTitle: (value) => text.save({ target: "title", text: value }), onNarrative: (value) => text.save({ target: "narrative", text: value }),
              onGroup: (index, value) => text.save({ target: "group", index, text: value }), onFlag: (index, value) => text.save({ target: "flag", index, text: value }) } }} />}
          {tab === "qa" && <QaPage controls={qaControls} onRefresh={qa.refresh} files={report.files.map((file) => file.path)} onOpenFile={showFile} />}
          {tab === "design" && <ReportSwimlanes diagrams={report.swimlanes ?? []} files={report.files.map(file => file.path)} onOpenFile={showFile} onSaveLayout={snapshot.id ? config.onSaveSwimlaneLayout : undefined} onAttach={snapshot.id ? config.onAttachDesign : undefined} onRemove={snapshot.id ? config.onRemoveDiagram : undefined} decisions={decisionControls} focusDiagramId={diagramFocus} />}
          {tab === "changes" && <ChangesPage config={{ review: fileReview }} />}
        </div>
      </section>
      {reviewOpen && <NodeDetails config={{ review: fileReview, onClose: closeReview }} />}
    </main>
  </>;
}
