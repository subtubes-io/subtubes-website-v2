"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Compatibility } from "@/lib/cloud-push/document-compatibility";
import {
  ListCell,
  ListEmpty,
  ListHeader,
  ListRow,
  ListSearch,
  ListTable,
  NameCell,
  OpenName,
  ago,
  type SnapshotMeta,
} from "@subtubes/report-ui";

import { cloneReportRequest } from "./clone-report";

export interface OrganizationReportSummary extends SnapshotMeta {
  projectName?: string;
  compatibility?: Compatibility;
}

export function OrganizationReportsList({
  slug,
  reports,
}: {
  slug: string;
  reports: OrganizationReportSummary[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"new" | "old" | "name">("new");
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clone = async (id: string) => {
    if (cloningId) return;
    setCloningId(id);
    setError(null);
    try {
      await cloneReportRequest(slug, id);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCloningId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports
      .filter(
        (item) =>
          !q ||
          `${item.name} ${item.title ?? ""} ${item.projectName ?? ""}`
            .toLowerCase()
            .includes(q)
      )
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "old") return a.savedAt.localeCompare(b.savedAt);
        return b.savedAt.localeCompare(a.savedAt);
      });
  }, [reports, query, sort]);

  const openReport = (id: string) => {
    router.push(`/dashboard/organizations/${slug}/reports/${encodeURIComponent(id)}`);
  };

  return (
    <div className="lib reports-library">
      <ListHeader
        title="Reports"
        meta={`${reports.length} total`}
      />
      <ListSearch
        id="libq"
        label="Search reports"
        placeholder="Search reports by name…"
        value={query}
        onChange={setQuery}
      >
        <select
          id="libsort"
          aria-label="Sort reports"
          value={sort}
          onChange={(e) => setSort(e.target.value as "new" | "old" | "name")}
        >
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
          <option value="name">Name</option>
        </select>
      </ListSearch>

      {error && <p className="report-notice-error" role="alert">{error}</p>}
      <ListTable
        label="Reports"
        columns="minmax(0,1fr) 190px 90px 190px"
        headings={["Name", "Changes", "Updated", ""]}
      >
        {filtered.map((item) => {
          const flags = item.info?.flags;
          const open = () => openReport(item.id);
          const blocked = item.compatibility && item.compatibility.status !== "supported";
          const status = item.compatibility?.status === "unsupported" ? "Requires a newer app" : "Invalid document";

          return (
            <ListRow key={item.id} data-id={item.id} onOpen={blocked ? undefined : open}>
              <NameCell
                name={<OpenName name={item.name} onOpen={open} disabled={Boolean(blocked)} />}
                detail={blocked ? `${status} · wire schema ${item.compatibility?.schemaVersion}` :
                  item.projectName && item.projectName !== item.name ? item.projectName : undefined}
              />
              <ListCell className="list-changes">
                {blocked ? <span>{status}</span> : item.stats ? (
                  <span>
                    {item.stats.files} {item.stats.files === 1 ? "file" : "files"} · +
                    {item.stats.additions} −{item.stats.deletions}
                  </span>
                ) : (
                  <span className="loc">—</span>
                )}
                {!blocked && flags && (flags.high || flags.medium || flags.low) ? (
                  <span className="fb">
                    {!!flags.high && <span className="sev high">{flags.high} high</span>}
                    {!!flags.medium && <span className="sev medium">{flags.medium} med</span>}
                    {!!flags.low && <span className="sev low">{flags.low} low</span>}
                  </span>
                ) : !blocked ? (
                  <span className="loc">no flags</span>
                ) : null}
              </ListCell>
              <ListCell className="loc">
                <span title={new Date(item.savedAt).toLocaleString()}>
                  {ago(item.savedAt)}
                </span>
              </ListCell>
              <ListCell className="list-row-actions">
                {!blocked && <button
                  type="button"
                  data-a="clone"
                  className="button-secondary"
                  disabled={cloningId !== null}
                  title="Make an independent copy of this report"
                  onClick={(e) => { e.stopPropagation(); void clone(item.id); }}
                >
                  {cloningId === item.id ? "Cloning…" : "Clone"}
                </button>}
                {!blocked && <Link
                  href={`/dashboard/organizations/${slug}/reports/${encodeURIComponent(item.id)}`}
                  className="button-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Link>}
              </ListCell>
            </ListRow>
          );
        })}
        {!filtered.length && (
          <ListEmpty>
            {reports.length
              ? "No reports match your search."
              : "No reports yet. Push reports from the Subtubes desktop app or your coding agent."}
          </ListEmpty>
        )}
      </ListTable>
    </div>
  );
}
