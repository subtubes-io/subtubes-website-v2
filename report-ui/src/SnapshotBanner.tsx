"use client";
import type { ReportSnapshotMeta } from "./model/snapshots";

const when = (iso: string) => new Date(iso).toLocaleString();

/** Shown above a snapshot: what it is, whether it is bound to a commit, and the way back to the live report. */
export function SnapshotBanner({
  snapshot,
  onBack,
  onDelete,
}: {
  snapshot: ReportSnapshotMeta;
  onBack: () => void;
  onDelete?: () => void;
}) {
  const { commit } = snapshot;
  return (
    <div className="snapshot-banner" role="status" aria-label="Viewing a snapshot">
      <div>
        <b>Snapshot #{snapshot.number}</b> · taken {when(snapshot.takenAt)} · read-only
        {snapshot.note && <> · “{snapshot.note}”</>}
        <div className="loc">
          {commit ? (
            <>
              Bound to <code>{commit.shortSha}</code> {commit.subject}
              {commit.branch ? ` on ${commit.branch}` : ""}
              {commit.uncommittedFiles.length ? (
                <>
                  {" "}· {commit.uncommittedFiles.length}{" "}
                  {commit.uncommittedFiles.length === 1 ? "file" : "files"} of the report not in the commit
                </>
              ) : null}
            </>
          ) : (
            "Not bound to a commit"
          )}
        </div>
      </div>
      <div className="snapshot-banner-actions">
        {onDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete snapshot
          </button>
        )}
        <button type="button" className="primary" onClick={onBack}>
          Back to live report
        </button>
      </div>
    </div>
  );
}
