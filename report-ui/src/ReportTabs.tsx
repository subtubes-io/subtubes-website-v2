"use client";
/** The pages a report can show. Deep links and focus handling use these names. */
export type ReportTab = "summary" | "qa" | "design" | "changes";

interface Config {
  active?: ReportTab;
  onSelect?: (tab: ReportTab) => void;
}

export function ReportTabs({ config }: { config: Config }) {
  const { active, onSelect } = config;
  const chapters: [ReportTab, string, string][] = [
    ["summary", "Summary", "The story at a glance"],
    ["qa", "QA", "How the change was exercised: screenshots and notes in the order someone followed them"],
    ["design", "Design", "What was intended: the design diagrams"],
    ["changes", "Changes", "What changed: the diff, file by file"],
  ];
  return <div className="report-nav">
    <div className="tabs" role="group" aria-label="Report chapters">
      {chapters.map(([name, label, title]) =>
        <button type="button" key={name} data-t={name} title={title} className={active === name ? "on" : ""} aria-pressed={active === name} disabled={!onSelect} onClick={() => onSelect?.(name)}>{label}</button>)}
    </div>
  </div>;
}
