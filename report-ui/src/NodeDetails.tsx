"use client";
import { useLayoutEffect, useRef } from "react";
import { FileReview, type FileReviewConfig } from "./FileReview";

/** The drawer that opens a file's diff beside the diagram step that refers to it. */
export function NodeDetails({ config }: { config: { review: FileReviewConfig; onClose: () => void } }) {
  const { review, onClose } = config;
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  return <aside className="detail detail-overlay detail-drawer" aria-label="Node details">
    <div className="detail-actions">
      <span className="loc">File review · {review.report.files.filter((file) => file.reviewed).length} of {review.report.files.length} files approved</span>
      <button ref={close} className="x" type="button" aria-label="Close node details" title="Close" onClick={onClose}>×</button>
    </div>
    <div className="detail-content">
      <FileReview config={review} />
    </div>
  </aside>;
}
