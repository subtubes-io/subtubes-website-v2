import type { AttachmentRequest, AttachmentResult } from "./model/attachments";
import type { DecisionRequest, DecisionResult } from "./model/decisions";
import type { DesignContent, DesignRequest, DesignResult } from "./model/designs";
import type { FileDiff } from "./model/types";
import type { QaRequest, QaResult } from "./model/qa";
import type { ReportDesignRequest, ReportDesignResult } from "./model/report-designs";
import type { ReportTextRequest, ReportTextResult } from "./model/report-text";

/**
 * Everything the report components need from the host application. The desktop app connects these to its native
 * commands; a website can leave most of them alone. Editing features switch on only when a `reportScope` is given
 * to the report, so a report shown without one is read-only and never calls the write operations below.
 */
export interface ReportServices {
  /** Reads one stored image by its hash. A read-only host supplies this (for example from a URL); it is the one thing a report cannot render without. */
  attachmentBytes(hash: string): Promise<ArrayBuffer | number[]>;
  /** Asks the person to confirm before something is deleted. */
  ask(message: string, options?: { title?: string; kind?: "info" | "warning" | "error" }): Promise<boolean>;
  writeText(text: string): Promise<void>;
  logAppEvent(level: "info" | "warn" | "error", message: string): Promise<void>;
  /** Whether a saved design is shown in design pickers; a host that groups designs (for example by organization) filters here. */
  designVisible(id: string): boolean;
  // Write operations: only used when a report is editable.
  decisions(request: DecisionRequest): Promise<DecisionResult>;
  qa(request: QaRequest): Promise<QaResult>;
  reportText(request: ReportTextRequest): Promise<ReportTextResult>;
  reportDesigns(request: ReportDesignRequest): Promise<ReportDesignResult>;
  attachments(request: AttachmentRequest): Promise<AttachmentResult>;
  /** Saves the positions of a diagram's nodes in the report; resolves with the saved report as JSON. */
  saveSwimlaneLayout(projectId: string, reportId: string, diagramId: string, expected: DesignContent, next: DesignContent): Promise<string>;
  /** Saves one file's approval; resolves with the saved report as JSON. */
  saveFileApproval(projectId: string, reportId: string, expectedFile: FileDiff, reviewed: boolean): Promise<string>;
  /** The list of saved designs, for attaching one to a report and for spotting a newer revision. */
  designs(request: DesignRequest): Promise<DesignResult>;
}

const unavailable = (what: string) => async (): Promise<never> => { throw new Error(`${what} is not available in this view.`); };

/**
 * The services in use. The defaults suit a read-only page: the browser's own confirm and clipboard, and nothing that
 * writes. Call `configureReportServices` once at start-up to connect a host.
 */
export const reportServices: ReportServices = {
  attachmentBytes: unavailable("Images"),
  ask: async (message) => (typeof window !== "undefined" ? window.confirm(message) : false),
  writeText: async (text) => { await navigator.clipboard.writeText(text); },
  logAppEvent: async (level, message) => { console[level === "info" ? "info" : level](message); },
  designVisible: () => true,
  decisions: unavailable("Decisions"),
  qa: unavailable("QA"),
  reportText: unavailable("Editing"),
  reportDesigns: unavailable("Report designs"),
  attachments: unavailable("Adding images"),
  saveSwimlaneLayout: unavailable("Saving a layout"),
  saveFileApproval: unavailable("Approving a file"),
  designs: unavailable("Designs"),
};

export function configureReportServices(services: Partial<ReportServices>): void {
  Object.assign(reportServices, services);
}
