"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesignRef, FileDiff, Report, Snapshot } from "./model/types";
import type { DesignContent } from "./model/designs";
import { reportSwimlanes } from "./model/report-swimlanes";
import type { ReportDesignChange } from "./model/report-designs";
import { Review } from "./Review";
import { reportServices } from "./services";

/** The report to show. Add where it is saved to make it editable. */
export interface ReportData {
  report: Report;
  /** Where the report is saved. Both are needed to edit it; without them the report can only be displayed. */
  projectId?: string;
  reportId?: string;
}

/**
 * Hooks for a host that draws its own chrome around the report (the desktop app does). A page that only displays a
 * report passes none of these.
 */
export interface ReportPageHost {
  /** Where the chapter menu is drawn, instead of at the top of the report. */
  menuHost?: HTMLElement | null;
  /** Extra controls at the end of the chapter menu, and a notice above the report. */
  menuExtras?: ReactNode;
  notice?: ReactNode;
  /** Keeps the report mounted but out of sight, so its state survives while something else is shown. */
  inactive?: boolean;
  /** Opens a live design linked from the report. */
  onOpenDesign?: (ref: DesignRef) => void;
  notify?: (message: string) => void;
  /** Set for a report that has not been saved yet; shows the "Save to project" banner. */
  unsaved?: { onSave: () => void; onReports: () => void };
}

/**
 * The whole report page: the Summary, QA, Design and Changes chapters. Pass the data (a report, or a `ReportData` that says where it is saved) and it renders it.
 *
 * `readOnlyMode` is on unless you turn it off. In read-only mode nothing can be changed and no write service is
 * called. Turn it off, and give `data` a `projectId` and `reportId`, to edit: wording, decisions, QA steps,
 * attached designs, diagram layouts and file approvals, all saved through `reportServices`.
 */
export function ReportPage({ data, readOnlyMode = true, host }: { data: ReportData | Report; readOnlyMode?: boolean; host?: ReportPageHost }) {
  const { report: shown, projectId, reportId } = "report" in data ? data : { report: data, projectId: undefined, reportId: undefined };
  const editable = !readOnlyMode && !!projectId && !!reportId;
  const [report, setReport] = useState(shown);
  useEffect(() => setReport(shown), [shown]);
  const latest = useRef(report);
  latest.current = report;
  const approving = useRef(false);

  const changeDiagrams = async (change: ReportDesignChange) => {
    const result = await reportServices.reportDesigns({ ...change, projectId: projectId!, reportId: reportId! });
    setReport((old) => ({ ...old, swimlanes: reportSwimlanes.parse(result.diagrams) }));
  };
  const saveLayout = async (diagramId: string, content: DesignContent) => {
    const diagram = latest.current.swimlanes?.find((item) => item.id === diagramId);
    if (!diagram) throw new Error("The diagram is no longer in this report.");
    reportSwimlanes.parse([{ id: diagramId, content }]);
    const saved = JSON.parse(await reportServices.saveSwimlaneLayout(projectId!, reportId!, diagramId, diagram.content, content)) as Snapshot;
    const updated = reportSwimlanes.parse(saved.report.swimlanes).find((item) => item.id === diagramId);
    if (!updated) throw new Error("The saved report is missing the diagram. Reopen it to verify its layout.");
    setReport((old) => ({ ...old, swimlanes: old.swimlanes?.map((item) => item.id === diagramId ? updated : item) }));
  };
  const approveFile = async (path: string, reviewed: boolean) => {
    const file = latest.current.files.find((item): item is FileDiff => item.path === path);
    if (!file) throw new Error("The file is no longer in this report.");
    if (approving.current) throw new Error("A file approval is already saving. Try again after it finishes.");
    approving.current = true;
    try {
      const saved = JSON.parse(await reportServices.saveFileApproval(projectId!, reportId!, file, reviewed)) as Snapshot;
      const savedFile = saved.report.files.find((item) => item.path === path);
      if (!savedFile || savedFile.reviewed !== reviewed) throw new Error("The saved report did not confirm the requested approval. Reopen the report to verify it.");
      setReport((old) => ({ ...old, files: old.files.map((item) => item.path === path ? { ...item, reviewed: savedFile.reviewed } : item) }));
    } finally { approving.current = false; }
  };

  return <Review config={{
    report,
    // An empty ID marks a report that has not been saved; a displayed report is not "unsaved", so it gets a placeholder.
    snapshot: { id: host?.unsaved ? "" : reportId ?? "read-only", name: report.title ?? "Report", savedAt: report.generatedAt },
    notify: host?.notify ?? (() => undefined),
    onSave: host?.unsaved?.onSave ?? (() => undefined), onReports: host?.unsaved?.onReports ?? (() => undefined),
    ...(host?.onOpenDesign ? { onOpenDesign: host.onOpenDesign } : {}),
    menuHost: host?.menuHost, menuExtras: host?.menuExtras, notice: host?.notice, inactive: host?.inactive,
    ...(editable ? {
      reportScope: { projectId: projectId!, reportId: reportId! },
      onSaveSwimlaneLayout: saveLayout,
      onAttachDesign: async (designId: string) => { await changeDiagrams({ action: "attach", designId }); },
      onRemoveDiagram: async (diagramId: string) => { await changeDiagrams({ action: "remove", diagramId }); },
      onApproveFile: approveFile,
    } : {}),
  }} />;
}
