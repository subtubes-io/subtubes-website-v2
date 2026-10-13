"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionChange, Decision } from "./model/decisions";
import { reportServices } from "./services";
import type { ReportScope } from "./report-scope";

export function useDecisions(scope: ReportScope | undefined, initial: Decision[], notify: (message: string) => void) {
  const [decisions, setDecisions] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false), writing = useRef(false), sequence = useRef(0), lastError = useRef("");
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const projectId = scope?.projectId, reportId = scope?.reportId;
  const reportError = useCallback((error: unknown) => {
    const message = `Could not update decisions: ${String(error)}`;
    console.error(error);
    if (lastError.current !== message) notifyRef.current(message);
    lastError.current = message; setError(message);
    void reportServices.logAppEvent("error", message).catch((loggingError: unknown) => console.error("Unable to log decision error:", loggingError));
  }, []);
  const refresh = useCallback(async () => {
    if (!projectId || !reportId || writing.current) return;
    const token = ++sequence.current;
    try {
      const result = await reportServices.decisions({ action: "list", projectId, reportId });
      if (mounted.current && token === sequence.current && !writing.current) { setDecisions(result.decisions); setError(""); lastError.current = ""; }
    } catch (error) { if (mounted.current && token === sequence.current) reportError(error); }
  }, [projectId, reportId, reportError]);
  // Polling shows replies and resolutions an agent saves through MCP while the report is open.
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
  const mutate = async (change: DecisionChange) => {
    if (!projectId || !reportId) throw new Error("Save the report to a project before recording decisions.");
    if (writing.current) throw new Error("A decision is saving. Try again when it finishes.");
    writing.current = true; setBusy(true); const token = ++sequence.current;
    try {
      const result = await reportServices.decisions({ ...change, projectId, reportId });
      if (mounted.current && token === sequence.current) { setDecisions(result.decisions); setError(""); lastError.current = ""; }
      return result;
    } catch (error) { if (mounted.current && token === sequence.current) reportError(error); throw error; }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  };
  return { decisions, busy, error, refresh, mutate, enabled: !!projectId && !!reportId };
}
