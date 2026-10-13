"use client";

// The report components as a library. Import from here, not from individual files.

export * from "./ReportPage";
export * from "./ListView";
export * from "./SnapshotBanner";
export * from "./Review";
export * from "./SummaryPage";
export * from "./ChangesPage";
export * from "./FileReview";
export * from "./FileTree";
export * from "./DiffView";
export * from "./DiffContextMenu";
export * from "./NodeDetails";
export * from "./ReportTabs";
export * from "./ReportMarkdown";
export * from "./ReportSwimlanes";
export * from "./DesignRefs";
export * from "./Decisions";
export * from "./JudgementCalls";
export * from "./QaPage";
export * from "./WalkthroughCarousel";
export * from "./AttachmentImage";
export * from "./EditableText";
export * from "./DeleteDialog";
export * from "./DesignPicker";
export * from "./DesignCanvas";
export * from "./DesignNodeDrawer";
export * from "./DesignNodeStatus";
export * from "./DesignInlineField";
export * from "./DesignColorPicker";
export * from "./VisualReview";
export * from "./ThemedSelect";
export * from "./MarkdownImageField";
export * from "./useDecisions";
export * from "./useQa";
export * from "./useReportText";
export * from "./useDiagramPreviews";
export * from "./useImageAttach";
export * from "./attachments";
export * from "./design-layout";
export * from "./design-image";
export * from "./diffrows";
export * from "./syntax";
export * from "./report-utils";
export * from "./report-scope";
export * from "./risk-labels";
export * from "./services";

// The data contract the components read.
export type * from "./model/types";
export type * from "./model/decisions";
export type * from "./model/qa";
export type { DesignNodeStatus, DesignContent, DesignNode, DesignGroup, DesignLink, SavedDesign, DesignSummary, DesignRequest } from "./model/designs";
export type * from "./model/design-legend";
export type * from "./model/snapshots";
export type * from "./model/report-swimlanes";
export type * from "./model/report-text";
export type * from "./model/report-designs";
export type * from "./model/anchors";
// Runtime helpers and schemas of the data contract (for example walkthroughsOf, designContent) are imported from "@subtubes/report-ui/model/<name>".
