"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export interface OrganizationReportSummary extends SnapshotMeta {
  projectName?: string;
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

      <ListTable
        label="Reports"
        columns="minmax(0,1fr) 190px 190px 90px 90px"
        headings={["Name", "Changes", "Snapshots", "Updated", ""]}
      >
        {filtered.map((item) => {
          const flags = item.info?.flags;
          const latest = item.snapshots?.latest;
          const open = () => openReport(item.id);

          return (
            <ListRow key={item.id} data-id={item.id} onOpen={open}>
              <NameCell
                name={<OpenName name={item.name} onOpen={open} />}
                detail={item.projectName && item.projectName !== item.name ? item.projectName : undefined}
              />
              <ListCell className="list-changes">
                {item.stats ? (
                  <span>
                    {item.stats.files} {item.stats.files === 1 ? "file" : "files"} · +
                    {item.stats.additions} −{item.stats.deletions}
                  </span>
                ) : (
                  <span className="loc">—</span>
                )}
                {flags && (flags.high || flags.medium || flags.low) ? (
                  <span className="fb">
                    {!!flags.high && <span className="sev high">{flags.high} high</span>}
                    {!!flags.medium && <span className="sev medium">{flags.medium} med</span>}
                    {!!flags.low && <span className="sev low">{flags.low} low</span>}
                  </span>
                ) : (
                  <span className="loc">no flags</span>
                )}
              </ListCell>
              <ListCell className="list-snapshots">
                {item.snapshots?.count ? (
                  <>
                    <span>
                      {item.snapshots.count}{" "}
                      {item.snapshots.count === 1 ? "snapshot" : "snapshots"}
                    </span>
                    <span className="loc" title={latest?.commit?.subject}>
                      {latest?.commit
                        ? `#${latest.number} · ${latest.commit.shortSha}`
                        : `#${latest?.number} · not bound to a commit`}
                    </span>
                  </>
                ) : (
                  <span className="loc">None yet</span>
                )}
              </ListCell>
              <ListCell className="loc">
                <span title={new Date(item.savedAt).toLocaleString()}>
                  {ago(item.savedAt)}
                </span>
              </ListCell>
              <ListCell className="list-row-actions">
                <Link
                  href={`/dashboard/organizations/${slug}/reports/${encodeURIComponent(item.id)}`}
                  className="button-secondary"
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Link>
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
