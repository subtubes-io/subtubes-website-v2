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
  snapshots: ReportSnapshotMeta[];
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
      if (!data.report) {
        throw new Error(`Snapshot #${number} has no report content.`);
      }
      setSnapshotReport(data.report);
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
            <option key={item.id} value={String(item.number)}>
              #{item.number} · {ago(item.takenAt)} ·{" "}
              {item.commit ? item.commit.shortSha : "not bound to a commit"}
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

  const notice = activeSnapshot ? (
    <SnapshotBanner
      snapshot={activeSnapshot}
      onBack={() => {
        setSelectedVersion("live");
        setSnapshotReport(null);
      }}
    />
  ) : error ? (
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
