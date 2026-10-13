"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QaChange, QaWalkthrough } from "./model/qa";
import { reportServices } from "./services";
import type { ReportScope } from "./report-scope";

export function useQa(scope: ReportScope | undefined, initial: QaWalkthrough[], notify: (message: string) => void) {
  const [walkthroughs, setWalkthroughs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false), writing = useRef(false), sequence = useRef(0), lastError = useRef("");
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const projectId = scope?.projectId, reportId = scope?.reportId;
  const reportError = useCallback((cause: unknown) => {
    const message = `Could not update QA: ${String(cause)}`;
    console.error(cause);
    if (lastError.current !== message) notifyRef.current(message);
    lastError.current = message; setError(message);
    void reportServices.logAppEvent("error", message).catch((loggingError: unknown) => console.error("Unable to log QA error:", loggingError));
  }, []);
  const refresh = useCallback(async () => {
    if (!projectId || !reportId || writing.current) return;
    const token = ++sequence.current;
    try {
      const result = await reportServices.qa({ action: "list", projectId, reportId });
      if (mounted.current && token === sequence.current && !writing.current) { setWalkthroughs(result.walkthroughs); setError(""); lastError.current = ""; }
    } catch (cause) { if (mounted.current && token === sequence.current) reportError(cause); }
  }, [projectId, reportId, reportError]);
  // Polling shows steps an agent records through MCP while the report is open.
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      await refresh();
      if (active) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { active = false; mounted.current = false; ++sequence.current; clearTimeout(timer); };
  }, [refresh]);
  const mutate = async (change: QaChange) => {
    if (!projectId || !reportId) throw new Error("Save the report to a project before recording QA.");
    if (writing.current) throw new Error("A QA step is saving. Try again when it finishes.");
    writing.current = true; setBusy(true); const token = ++sequence.current;
    try {
      const result = await reportServices.qa({ ...change, projectId, reportId });
      if (mounted.current && token === sequence.current) { setWalkthroughs(result.walkthroughs); setError(""); lastError.current = ""; }
      return result;
    } catch (cause) { if (mounted.current && token === sequence.current) reportError(cause); throw cause; }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  return { walkthroughs, busy, error, refresh, mutate, enabled: !!projectId && !!reportId };
}
