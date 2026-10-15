import type { Selectable } from "kysely";
import type { Report } from "@subtubes/report-ui";
import { normalizeReport } from "../report-ui/src/report-utils";
import type { Database } from "@/lib/db/types";
import { DocumentError, type Compatibility } from "@/lib/cloud-push/document-compatibility";
import { reportCompatibility, reportDocument } from "@/lib/cloud-push/reports";

type StoredReport = Selectable<Database["report"]>;
type WebsiteReport = { compatibility: Compatibility; report?: Report };

export function readWebsiteReport(row: StoredReport): WebsiteReport {
  const reader = { versions: [2], explicit: true };
  const compatibility = reportCompatibility(row, reader);
  if (compatibility.status !== "supported") return { compatibility };
  const content = reportDocument(row, reader);
  const marker = content.schemaVersion;
  if (marker !== undefined && (typeof marker !== "number" || !Number.isSafeInteger(marker) || marker < 1)) {
    console.error("Invalid report payload schema marker", row.id);
    return { compatibility: { status: "invalid", schemaVersion: row.schemaVersion, message: "Invalid document" } };
  }
  if (marker !== undefined && marker !== 1) {
    return { compatibility: {
      status: "unsupported", schemaVersion: row.schemaVersion,
      message: `Requires a newer app (report payload schema ${marker})`,
    } };
  }
  const report = normalizeReport(content);
  if (typeof report === "string") {
    console.error("Invalid report view document", row.id, report);
    return { compatibility: { status: "invalid", schemaVersion: row.schemaVersion, message: "Invalid document" } };
  }
  return { compatibility, report };
}

export function requireWebsiteReport(row: StoredReport): Report {
  const result = readWebsiteReport(row);
  if (!result.report) {
    throw new DocumentError(result.compatibility.status === "unsupported" ? 426 : 422,
      result.compatibility.status === "unsupported" ? "upgrade_required" : "invalid_document",
      result.compatibility.status === "unsupported" ? "Requires a newer app" : "Invalid document",
      { documentType: "report", schemaVersion: row.schemaVersion });
  }
  return result.report;
}
