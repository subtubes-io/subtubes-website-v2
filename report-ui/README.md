# @subtubes/report-ui

The report components of Subtubes IRE as a React library: the Summary, QA, Design and Changes chapters, the diff viewer, the diagram canvas, Markdown rendering, decisions and the walkthrough carousel. The desktop app and, later, the web app render a report with the same code.

Nothing here knows about Tauri. Everything the components need from their host goes through one object, `reportServices`, so a website can show a report **read only** and the desktop app can switch editing on.

## Use it

One component renders the whole report page. Pass it the data; `readOnlyMode` is on unless you turn it off.

```tsx
import "@subtubes/report-ui/styles.css";
import { ReportPage, configureReportServices } from "@subtubes/report-ui";

// Images are stored by hash; tell the library where to read them from.
configureReportServices({
  attachmentBytes: async (hash) => (await fetch(`/api/blobs/${hash}`)).arrayBuffer(),
});

// A website: read only.
<ReportPage data={report} />

// The desktop app: editable, saved to a project through the services.
<ReportPage data={{ report, projectId, reportId }} readOnlyMode={false} />
```

| Prop | Meaning |
|---|---|
| `data` | A report, or `{ report, projectId, reportId }` when it is saved somewhere and may be edited. |
| `readOnlyMode` | `true` by default. In read-only mode nothing can be changed and no write service is called (a test enforces it). Set `false`, with a `projectId` and `reportId` in `data`, to edit wording, decisions, QA steps, attached designs, diagram layouts and file approvals. |
| `host` | Optional, for a host that draws its own chrome around the report (the desktop app does): where to draw the chapter menu, extra menu controls, a notice, `onOpenDesign`, and the unsaved-report banner. A page that only displays a report passes none of it. |

## What the host provides: `ReportServices`

| Service | Needed for | Read-only host |
|---|---|---|
| `attachmentBytes(hash)` | Every image: QA screenshots, design previews, images in Markdown | **Required** |
| `ask`, `writeText`, `logAppEvent` | Confirmations, copy buttons, error logging | Browser defaults are built in |
| `designVisible(id)` | Filters the design picker (the desktop app filters by organization) | Default shows all |
| `decisions`, `qa`, `reportText`, `reportDesigns`, `attachments`, `designs`, `saveSwimlaneLayout`, `saveFileApproval` | Editing (`readOnlyMode={false}`) | Not used; they reject if called |

A report is editable only with `readOnlyMode={false}` and a saved location in `data`. Otherwise every editing control is absent or disabled.

## What is in the package

- **The page:** `ReportPage`. The pieces below are what it is made of; most hosts never need them directly.
- **Report views:** `Review` (all chapters with the chapter menu), `SummaryPage`, `QaPage`, `ReportSwimlanes`, `ChangesPage`, `FileReview`, `DiffView`, `FileTree`, `NodeDetails`, `Decisions`, `JudgementCalls`, `WalkthroughCarousel`, `VisualReview`.
- **Diagram pieces:** `DesignCanvas`, `DesignNodeDrawer`, `DesignInlineField`, `DesignColorPicker`, `DesignNodeStatus`, `DesignPicker`, plus `design-layout` and `design-image` helpers.
- **Building blocks:** `ReportMarkdown`, `AttachmentImage`, `EditableText`, `DeleteDialog`, `ThemedSelect`, `MarkdownImageField`, and the hooks `useDecisions`, `useQa`, `useReportText`, `useDiagramPreviews`, `useImageAttach`.
- **`@subtubes/report-ui/styles.css`:** the colour tokens (light and dark, chosen by `data-theme` on `<html>`) and every style the components use.
- **`@subtubes/report-ui/model/*`:** the report data contract (types and zod schemas such as `walkthroughsOf`). It is defined once, beside the MCP server in `../src`, and re-exported here (`src/model/`). If the contract moves into this package later, only those files change.
- **`@subtubes/report-ui/fixtures`:** a sample report for tests and demos.

## Report data

The components read the app's `Report` shape. A report pushed to the cloud is the version-2 document in `docs/cloud-sync-contract.md`; it differs in small ways (no `repoRoot`, a `repo` block, images as hashes), all of which the components already tolerate.

## Peer dependencies

`react`, `react-dom`, `react-markdown`, `lucide-react`, `lowlight`, `highlight.js` and `zod`. The package ships TypeScript source, so the host's bundler compiles it (`sideEffects` marks only the CSS).

## In this repository

The desktop app renders every report, live or a frozen snapshot, with `ReportPage` (see `app/src/ReportHost.tsx`) and imports the package through an alias (`app/vite.config.ts`, `app/tsconfig.json`) and connects the services in `app/src/report-services.ts`. The library's tests run with the app's: `cd app && npx vitest run`. The app's own chrome (header, lists, snapshots, push, account) stays in `app/`.
