"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReportPage,
  SnapshotBanner,
  ago,
  normalizeReport,
  type Report,
  type ReportSnapshotMeta,
} from "@subtubes/report-ui";
import { ensureReportServicesConfigured } from "./report-client-init";
import type { Compatibility } from "@/lib/cloud-push/document-compatibility";

export interface WebsiteSnapshotMeta extends ReportSnapshotMeta {
  compatibility: Compatibility;
}

export function ReportViewer({
  report: initialReport,
  reportId,
  projectName,
  slug,
  snapshots,
}: {
  report: Report;
  reportId: string;
  projectName: string;
  slug: string;
  snapshots: WebsiteSnapshotMeta[];
}) {
  useEffect(() => {
    ensureReportServicesConfigured();
  }, []);

  const [selectedVersion, setSelectedVersion] = useState<number | "live">("live");
  const [snapshotReport, setSnapshotReport] = useState<Report | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSnapshot =
    selectedVersion !== "live"
      ? snapshots.find((s) => s.number === selectedVersion)
      : undefined;

  const loadSnapshot = async (number: number) => {
    const snapshot = snapshots.find((item) => item.number === number);
    if (!snapshot || snapshot.compatibility.status !== "supported") {
      setError(snapshot?.compatibility.status === "unsupported" ? "Requires a newer app" : "Invalid document");
      return;
    }
    setLoadingSnapshot(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(slug)}/reports/${encodeURIComponent(
          reportId
        )}/snapshots/${number}`
      );
      if (!res.ok) {
        throw new Error(`Failed to load snapshot #${number}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.schemaVersion !== 2) throw new Error("Requires a newer app");
      const marker: unknown = data.report?.schemaVersion;
      if (marker !== undefined && (typeof marker !== "number" || !Number.isSafeInteger(marker) || marker < 1)) {
        throw new Error("Invalid document");
      }
      if (marker !== undefined && marker !== 1) throw new Error("Requires a newer app");
      const normalized = normalizeReport(data.report);
      if (typeof normalized === "string") throw new Error("Invalid document");
      setSnapshotReport(normalized);
      setSelectedVersion(number);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const handleVersionChange = (value: string) => {
    if (value === "live") {
      setSelectedVersion("live");
      setSnapshotReport(null);
    } else {
      void loadSnapshot(Number(value));
    }
  };

  const menuExtras = (
    <div className="snapshot-menu">
      <label className="snapshot-select">
        <span className="loc">Version</span>
        <select
          aria-label="Snapshots"
          value={selectedVersion === "live" ? "live" : String(selectedVersion)}
          onChange={(e) => handleVersionChange(e.target.value)}
          disabled={loadingSnapshot}
        >
          <option value="live">Live report</option>
          {[...snapshots].reverse().map((item) => (
            <option key={item.id} value={String(item.number)} disabled={item.compatibility.status !== "supported"}>
              #{item.number} · {ago(item.takenAt)} ·{" "}
              {item.compatibility.status === "unsupported" ? `Requires a newer app · wire schema ${item.compatibility.schemaVersion}` :
                item.compatibility.status === "invalid" ? "Invalid document" :
                  item.commit ? item.commit.shortSha : "not bound to a commit"}
            </option>
          ))}
        </select>
      </label>
      <Link
        href={`/dashboard/organizations/${slug}`}
        className="button-secondary"
        style={{ fontSize: "12px", padding: "6px 12px" }}
      >
        All reports
      </Link>
    </div>
  );

  const notice = error ? (
    <div className="snapshot-banner" role="alert">
      <span className="snapshot-error">{error}</span>
      <button
        type="button"
        className="primary"
        onClick={() => {
          setSelectedVersion("live");
          setSnapshotReport(null);
          setError(null);
        }}
      >
        Back to live report
      </button>
    </div>
  ) : activeSnapshot ? (
    <SnapshotBanner
      snapshot={activeSnapshot}
      onBack={() => {
        setSelectedVersion("live");
        setSnapshotReport(null);
      }}
    />
  ) : null;

  const currentReport = useMemo(() => {
    const target =
      selectedVersion !== "live" && snapshotReport ? snapshotReport : initialReport;
    const normalized = normalizeReport(target);
    return typeof normalized === "string" ? target : normalized;
  }, [selectedVersion, snapshotReport, initialReport]);

  return (
    <div className="report-viewer-wrap">
      <ReportPage
        key={selectedVersion}
        data={{ report: currentReport }}
        readOnlyMode={true}
        host={{
          menuExtras,
          notice,
        }}
      />
    </div>
  );
}
