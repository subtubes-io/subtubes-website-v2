"use client";
import { useMemo, useRef, useState } from "react";
import type { Flag, IntentGroup, Report } from "./model/types";
import type { ReportTextChange } from "./model/report-text";
import { reportServices } from "./services";
import type { ReportScope } from "./report-scope";

/** The written parts of a report that a person can change in place, kept current as edits are saved. */
export function useReportText(scope: ReportScope | undefined, report: Report) {
  const [fields, setFields] = useState<{ title?: string; narrative: string; groups: IntentGroup[]; flags: Flag[] }>({ title: report.title, narrative: report.narrative, groups: report.groups, flags: report.flags });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = (change: ReportTextChange) => {
    if (!scope) return Promise.reject(new Error("Save the report to a project before editing it."));
    const run = queue.current.then(async () => {
      const result = await reportServices.reportText({ ...change, ...scope });
      setFields({ title: result.title, narrative: result.narrative, groups: result.groups, flags: result.flags });
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const shown = useMemo(() => ({ ...report, ...fields }) as Report, [report, fields]);
  return { report: shown, enabled: !!scope, save };
}
