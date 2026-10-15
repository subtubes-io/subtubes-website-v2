"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReportPage, normalizeReport, type Report } from "@subtubes/report-ui";
import { ensureReportServicesConfigured } from "./report-client-init";
import { cloneReportRequest } from "./clone-report";

export function ReportViewer({
  report: initialReport,
  reportId,
  slug,
}: {
  report: Report;
  reportId: string;
  projectName: string;
  slug: string;
}) {
  const router = useRouter();
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureReportServicesConfigured();
  }, []);

  const clone = async () => {
    if (cloning) return;
    setCloning(true);
    setError(null);
    try {
      const copy = await cloneReportRequest(slug, reportId);
      router.push(`/dashboard/organizations/${encodeURIComponent(slug)}/reports/${encodeURIComponent(copy.reportId)}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setCloning(false);
    }
  };

  const menuExtras = (
    <div className="report-actions">
      <button type="button" id="clonereport" className="button-secondary" disabled={cloning} onClick={() => void clone()}>
        {cloning ? "Cloning…" : "Clone report"}
      </button>
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
    <div className="report-notice" role="alert">
      <span className="report-notice-error">{error}</span>
      <button type="button" onClick={() => setError(null)}>Dismiss</button>
    </div>
  ) : null;

  const currentReport = useMemo(() => {
    const normalized = normalizeReport(initialReport);
    return typeof normalized === "string" ? initialReport : normalized;
  }, [initialReport]);

  return (
    <div className="report-viewer-wrap">
      <ReportPage
        data={{ report: currentReport }}
        readOnlyMode={true}
        host={{ menuExtras, notice }}
      />
    </div>
  );
}
