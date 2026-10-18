"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { Table } from "@/components/ui/table";

export type ManagedReport = {
  id: string;
  title: string;
  branch: string;
  commitCount: number;
  fileCount: number;
  additions: number;
  deletions: number;
  sizeBytes: number;
  createdAt: string;
  publisher: string;
  canDelete: boolean;
};

type ReportsTableConfig = { organizationId: string; reports: ManagedReport[] };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

const formatSize = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

// Reports are managed here, not read: the table lists them and lets the people who may delete one do so.
export function PullRequestReportsTable({ config }: { config: ReportsTableConfig }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(report: ManagedReport) {
    setPending(report.id);
    setError("");
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(config.organizationId)}/pull-request-reports/${encodeURIComponent(report.id)}`,
        { method: "DELETE" },
      );
      // Already gone is what was asked for.
      if (response.status !== 204 && response.status !== 404) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "The report could not be deleted. Please try again.");
      }
      setConfirming(null);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The report could not be deleted. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {error && <FormError>{error}</FormError>}
      <Table<ManagedReport> config={{
        caption: "Published reports",
        columns: [
          { id: "title", header: "Report", cell: (report) => report.title || "Untitled report" },
          { id: "branch", header: "Branch", cell: (report) => <code>{report.branch}</code> },
          { id: "changes", header: "Changes", cell: (report) => `${report.commitCount} commit${report.commitCount === 1 ? "" : "s"} · ${report.fileCount} file${report.fileCount === 1 ? "" : "s"} · +${report.additions} −${report.deletions}` },
          { id: "publisher", header: "Published by", cell: (report) => report.publisher },
          { id: "published", header: "Published (UTC)", cell: (report) => dateFormatter.format(new Date(report.createdAt)) },
          { id: "size", header: "Size", align: "right", cell: (report) => formatSize(report.sizeBytes) },
          { id: "actions", header: "Actions", cell: (report) => !report.canDelete ? null : confirming === report.id ? (
            <div className="invitation-actions">
              <Button variant="secondary" size="compact" disabled={pending !== null} aria-label={`Confirm deleting ${report.title}`} onClick={() => void remove(report)}>
                {pending === report.id ? "Deleting..." : "Delete for everyone"}
              </Button>
              <Button variant="secondary" size="compact" disabled={pending !== null} onClick={() => setConfirming(null)}>Keep</Button>
            </div>
          ) : (
            <Button variant="secondary" size="compact" disabled={pending !== null} aria-label={`Delete ${report.title}`} onClick={() => { setError(""); setConfirming(report.id); }}>
              Delete
            </Button>
          ) },
        ],
        rows: config.reports,
        rowKey: (report) => report.id,
        emptyMessage: "No reports have been published to this organization yet. Publish one from the Subtubes desktop app.",
      }} />
    </>
  );
}
