"use client";
import { useEffect, useRef } from "react";
import { FileReview, type FileReviewConfig } from "./FileReview";

/** What changed: the diff as a chapter of its own, with the file navigator, approvals, notes and the decisions on each file. */
export function ChangesPage({ config }: { config: { review: FileReviewConfig } }) {
  const { report } = config.review;
  const page = useRef<HTMLElement>(null);
  // Arriving from a link elsewhere: keep keyboard focus in the page unless a child (such as a decision) already took it.
  useEffect(() => { if (!document.activeElement || document.activeElement === document.body) page.current?.focus({ preventScroll: true }); }, []);
  const approved = report.files.filter((file) => file.reviewed === true).length;
  return <section className="changes-page" aria-label="Changes" ref={page} tabIndex={-1}>
    <div className="changes-bar">
      <h2>Changes</h2>
      <span className="loc">{report.files.length} {report.files.length === 1 ? "file" : "files"} · +{report.stats.additions} / −{report.stats.deletions}</span>
      <span className="loc" role="status">{approved} of {report.files.length} files approved</span>
    </div>
    {report.files.length
      ? <div className="changes-body"><FileReview config={config.review} /></div>
      : <div className="empty">No files changed in this report.</div>}
  </section>;
}
