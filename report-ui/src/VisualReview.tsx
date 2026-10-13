"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Report, VisualAttempt, VisualScenario } from "./model/types";
import { ThemedSelect } from "./ThemedSelect";

export function visualScenarios(report: Report): VisualScenario[] {
  const legacy = new Map<string, VisualScenario>();
  for (const [filename, image] of Object.entries(report.shots ?? {}).sort()) {
    const match = filename.match(/^(.*)\.(before|after)\.png$/);
    if (!match) continue;
    const title = match[1], role = match[2] as "before" | "after";
    const scenario = legacy.get(title) ?? { id: `legacy:${title}`, title, file: "", project: "Screenshot",
      status: "passed", attempts: [], comparison: "capture", notes: ["Legacy capture: test results and revision provenance were not recorded."] };
    scenario[role] = image;
    legacy.set(title, scenario);
  }
  return [...(report.visual?.version === 1 ? report.visual.scenarios : []), ...legacy.values()];
}

function Attempts({ attempts, title }: { attempts: VisualAttempt[]; title: string }) {
  return <details className="visual-attempts"><summary>{title} ({attempts.length})</summary>
    {attempts.length ? attempts.map((attempt, index) => <div key={index}><strong>Attempt {attempt.retry + 1}: {attempt.status}</strong> · {attempt.durationMs} ms
      {attempt.errors.map((error, i) => <pre key={i}>{error}</pre>)}</div>) : <p>No test results recorded.</p>}
  </details>;
}

function EvidenceImage({ source, label, title, onSize, onFailure, thumbnail }: { source?: string; label: string; title: string; onSize?: (width: number, height: number) => void; onFailure?: () => void; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!source) return <p className="visual-missing">No {label.toLowerCase()} image attached.</p>;
  if (failed) return <p className="visual-missing" role="alert">Could not display {label.toLowerCase()} image.</p>;
  return <img src={source} loading={thumbnail ? "lazy" : "eager"} alt={`${title} ${label.toLowerCase()}`} onError={() => { setFailed(true); onFailure?.(); }} onLoad={(event) => onSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />;
}

function Comparison({ scenario, beforeLabel, afterLabel }: { scenario: VisualScenario; beforeLabel: string; afterLabel: string }) {
  const [mode, setMode] = useState<"side" | "slider" | "diff">("side");
  const [zoom, setZoom] = useState(100), [divider, setDivider] = useState(50);
  const [beforeSize, setBeforeSize] = useState<string>(), [afterSize, setAfterSize] = useState<string>();
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  const canSlide = !!scenario.before && !!scenario.after && !!beforeSize && beforeSize !== "0:0" && beforeSize === afterSize;
  const sync = (source: HTMLDivElement, target: HTMLDivElement | null) => {
    if (!target) return;
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  };
  return <>
    <div className="visual-controls" role="group" aria-label="Image comparison">
      <button aria-pressed={mode === "side"} onClick={() => setMode("side")}>Side by side</button>
      <button aria-pressed={mode === "slider"} disabled={!canSlide} onClick={() => setMode("slider")}>Comparison slider</button>
      <button aria-pressed={mode === "diff"} disabled={!scenario.diff} onClick={() => setMode("diff")}>Playwright diff</button>
      <div className="visual-select-field"><span>Zoom</span><ThemedSelect config={{ label: "Image zoom", value: String(zoom),
        options: [100, 150, 200, 300].map((value) => ({ value: String(value), label: `${value}%` })), onChange: (value) => setZoom(Number(value)) }} /></div>
    </div>
    {!canSlide && <p className="loc">The slider requires two successfully loaded images of equal dimensions.</p>}
    {mode === "side" && <div className="visual-pair">
      <figure><figcaption>{beforeLabel}</figcaption><div className="visual-scroll" ref={left} onScroll={(event) => sync(event.currentTarget, right.current)}>
        <div style={{ width: `${zoom}%` }}><EvidenceImage source={scenario.before} label={beforeLabel} title={scenario.title} onSize={(w, h) => setBeforeSize(`${w}:${h}`)} onFailure={() => setBeforeSize(undefined)} /></div>
      </div></figure>
      <figure><figcaption>{afterLabel}</figcaption><div className="visual-scroll" ref={right} onScroll={(event) => sync(event.currentTarget, left.current)}>
        <div style={{ width: `${zoom}%` }}><EvidenceImage source={scenario.after} label={afterLabel} title={scenario.title} onSize={(w, h) => setAfterSize(`${w}:${h}`)} onFailure={() => setAfterSize(undefined)} /></div>
      </div></figure>
    </div>}
    {mode === "slider" && <><label className="visual-divider" htmlFor="visual-divider-input">Before / after divider</label>
      <div className="visual-scroll visual-slider-scroll"><div className="visual-slider-surface" style={{ width: `${zoom}%` }}>
        <input id="visual-divider-input" className="visual-divider-input" type="range" min="0" max="100" value={divider} onChange={(event) => setDivider(Number(event.target.value))} />
        <div className="visual-overlay">
        <EvidenceImage source={scenario.before} label={beforeLabel} title={scenario.title} onFailure={() => { setBeforeSize(undefined); setMode("side"); }} />
        <div className="visual-overlay-after" style={{ clipPath: `inset(0 0 0 ${divider}%)` }}><EvidenceImage source={scenario.after} label={afterLabel} title={scenario.title} onFailure={() => { setAfterSize(undefined); setMode("side"); }} /></div>
        <div className="visual-divider-line" style={{ left: `${divider}%` }} />
      </div></div></div></>}
    {mode === "diff" && <div className="visual-scroll"><div style={{ width: `${zoom}%` }}><EvidenceImage source={scenario.diff} label="Playwright diff" title={scenario.title} /></div></div>}
  </>;
}

function ImageDialog({ scenario, beforeLabel, afterLabel, onClose }: { scenario: VisualScenario; beforeLabel: string; afterLabel: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="visual-dialog" aria-label={`Inspect ${scenario.title}`} onCancel={onClose}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="visual-dialog-heading"><h2>{scenario.title}</h2><button onClick={onClose} autoFocus>Close images</button></div>
    <Comparison scenario={scenario} beforeLabel={beforeLabel} afterLabel={afterLabel} />
  </dialog>;
}

export function VisualReview({ report }: { report: Report }) {
  const scenarios = useMemo(() => visualScenarios(report), [report.visual, report.shots]);
  const [selected, setSelected] = useState<VisualScenario>(), [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const unsupported = report.visual && report.visual.version !== 1;
  const visible = scenarios.filter((scenario) => (filter === "all" || scenario.status === filter) &&
    `${scenario.title} ${scenario.project} ${scenario.file}`.toLowerCase().includes(query.toLowerCase()));
  const labels = (scenario: VisualScenario) => scenario.comparison === "snapshot-baseline"
    ? { beforeLabel: "Expected baseline", afterLabel: "Actual" } : { beforeLabel: "Before", afterLabel: "After" };
  if (!scenarios.length && !unsupported) return <div className="empty">No visual evidence. The agent can call <code>import_playwright_results</code> after analysis, or <code>capture_screenshot</code> with label before/after, then publish the report.</div>;
  return <section className="visual-review" aria-label="Visual evidence">
    <h2>Visual evidence ({scenarios.length} scenarios)</h2>
    {unsupported && <p role="alert">This visual-evidence version is not supported. Export the original report to preserve it.</p>}
    {report.visual?.version === 1 && <div className="visual-provenance"><p>Playwright results · imported {report.visual.importedAt}</p>
      {(report.visual.beforeRevision || report.visual.afterRevision) && <p>Reported revisions (not verified): {report.visual.beforeRevision ?? "unspecified"} → {report.visual.afterRevision ?? "unspecified"}</p>}
      {report.visual.warnings.length > 0 && <details><summary>Import warnings ({report.visual.warnings.length})</summary><ul>{report.visual.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </div>}
    <div className="visual-controls"><input type="search" aria-label="Search visual scenarios" placeholder="Search scenarios, projects, files" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="visual-select-field"><span>Status</span><ThemedSelect config={{ label: "Visual test status", value: filter, onChange: setFilter,
        options: [{ value: "all", label: "All statuses" }, { value: "passed", label: "Passed" }, { value: "failed", label: "Failed" },
          { value: "flaky", label: "Flaky" }, { value: "timedOut", label: "Timed out" }, { value: "skipped", label: "Skipped" },
          { value: "interrupted", label: "Interrupted" }] }} /></div>
    </div>
    {!visible.length && <p>No visual scenarios match these filters.</p>}
    <div className="visual-gallery">{visible.map((scenario) => {
      const { beforeLabel, afterLabel } = labels(scenario);
      return <article className="visual-card" key={scenario.id}>
        <div className="visual-card-heading"><h3>{scenario.title}</h3><span className={`visual-status ${scenario.status}`}>{scenario.attempts.length ? scenario.status : "No test results"}</span></div>
        <p className="loc">{scenario.project}{scenario.file && ` · ${scenario.file}${scenario.line ? `:${scenario.line}` : ""}`} · {scenario.comparison === "snapshot-baseline" ? "Snapshot baseline comparison — not Git before/after" : scenario.comparison === "two-runs" ? "Two Playwright runs" : "Screenshot capture"}</p>
        <div className="visual-pair visual-thumbnails">{(["before", "after"] as const).map((role) => <figure key={role}>
          <figcaption>{role === "before" ? beforeLabel : afterLabel}</figcaption><EvidenceImage source={scenario[role]} label={role === "before" ? beforeLabel : afterLabel} title={scenario.title} thumbnail />
        </figure>)}</div>
        {scenario.notes.length > 0 && <ul className="visual-notes">{scenario.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        <button disabled={!scenario.before && !scenario.after && !scenario.diff} onClick={() => setSelected(scenario)}>Inspect images</button>
        <Attempts attempts={scenario.attempts} title="After test attempts" />
        {scenario.beforeAttempts && <Attempts attempts={scenario.beforeAttempts} title="Before test attempts" />}
      </article>;
    })}</div>
    {selected && <ImageDialog scenario={selected} {...labels(selected)} onClose={() => setSelected(undefined)} />}
  </section>;
}
