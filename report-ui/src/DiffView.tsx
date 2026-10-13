"use client";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FileDiff, Flag, Hunk } from "./model/types";
import { PREVIEW_LINES, splitRows, type DiffLayout, type DiffRow } from "./diffrows";
import { highlightHunk, type SyntaxLine } from "./syntax";
import { numberedHunk, type LineSide } from "./model/anchors";
import { DecisionCard, DecisionComposer, type DecisionControls } from "./Decisions";
import { EditableText } from "./EditableText";
import { ReportMarkdown } from "./ReportMarkdown";
import { DiffContextMenu, type DiffMenuItem } from "./DiffContextMenu";

export function FlagRow({ flag, onSelect, edit }: { flag: Flag; onSelect?: () => void; edit?: { enabled: boolean; onSave: (text: string) => Promise<void> } }) {
  // Editable: the message is edited where it stands and only the location leads to the file.
  if (edit) return <div className="flag flag-editable">
    <span className={`sev ${flag.severity}`}>{flag.severity}</span>
    <div className="flag-body">
      <EditableText label="Flag" enabled={edit.enabled} value={flag.message} onSave={edit.onSave}><ReportMarkdown config={{ text: flag.message }} /></EditableText>
      <button type="button" className="flag-location loc" onClick={onSelect} disabled={!onSelect} title={`Open ${flag.file}`}>{flag.file}:{flag.line}</button>
    </div>
  </div>;
  return <div className="flag" role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect} onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(); } }}>
    <span className={`sev ${flag.severity}`}>{flag.severity}</span><span>{flag.message} <span className="loc">{onSelect ? `${flag.file}:` : "line "}{flag.line}</span></span>
  </div>;
}

function SyntaxText({ tokens, text }: { tokens?: SyntaxLine; text: string }) {
  return <>{tokens?.length ? tokens.map((token, i) => <span key={i} className={token.className}>{token.text}</span>) : text || " "}</>;
}

function Cell({ row, side, tokens, active }: { row: DiffRow; side: "old" | "next"; tokens?: SyntaxLine; active?: boolean }) {
  const cell = row[side];
  return <div className={`diff-cell${cell?.changed ? side === "old" ? " d" : " a" : ""}${!cell ? " diff-gap" : ""}`}><span className="diff-line-number">{cell?.line || ""}</span><span className={`diff-code${active ? " diff-target" : ""}`} tabIndex={cell?.line ? -1 : undefined} data-old-line={side === "old" ? cell?.line : undefined} data-new-line={side === "next" ? cell?.line : undefined}><SyntaxText tokens={tokens} text={cell?.text ?? ""} /></span></div>;
}

function DiffHunk({ hunk, layout, path, oldPath, decisions }: { hunk: Hunk; layout: DiffLayout; path: string; oldPath?: string; decisions?: DecisionControls }) {
  const [expanded, setExpanded] = useState(false);
  const [deciding, setDeciding] = useState<{ side: LineSide; line: number; text: string; selection?: string; endLine?: number }>();
  const [menu, setMenu] = useState<{ x: number; y: number; target: NonNullable<typeof deciding>; returnTo?: HTMLElement }>();
  const [selectionError, setSelectionError] = useState("");
  // The browser may select a word on right-click, so the reviewer's own selection is read before that happens.
  const selectionBefore = useRef<Range | undefined>(undefined), viaKeyboard = useRef(false);
  const id = useId();
  const container = useRef<HTMLElement>(null);
  const rows = splitRows(hunk);
  const numbered = numberedHunk(hunk);
  const decisionFocus = decisions?.focus?.decisionId;
  const containsDecisionFocus = !!decisionFocus && !!decisions?.decisions.find((item) => item.id === decisionFocus)?.anchors.some((anchor) => anchor.type === "line" && anchor.anchor.file === path
    && numbered.some((row) => (anchor.anchor.side === "old" ? row.oldLine : row.newLine) === anchor.anchor.line));
  useEffect(() => { if (containsDecisionFocus) setExpanded(true); }, [containsDecisionFocus, decisionFocus]);
  useEffect(() => {
    if (!expanded || !containsDecisionFocus || !decisionFocus) return;
    const element = container.current?.querySelector<HTMLElement>(`#decision-${decisionFocus}`);
    element?.scrollIntoView?.({ block: "center" }); element?.focus({ preventScroll: true });
  }, [expanded, containsDecisionFocus, decisionFocus]);
  const syntax = useMemo(() => highlightHunk(hunk, path, oldPath), [hunk, path, oldPath]);
  const remaining = (layout === "split" ? rows.length : hunk.lines.length) - PREVIEW_LINES;
  const heading = <div className="h">@@ -{hunk.oldStart} +{hunk.newStart} @@</div>;
  type Target = NonNullable<typeof deciding>;
  const lineTarget = (code: HTMLElement): Target | undefined => {
    const side: LineSide = code.hasAttribute("data-new-line") ? "new" : "old";
    const line = Number(code.getAttribute(side === "new" ? "data-new-line" : "data-old-line"));
    const row = numbered.find((item) => (side === "old" ? item.oldLine : item.newLine) === line);
    return row && line > 0 ? { side, line, text: row.text.slice(1) } : undefined;
  };
  /** The lines covered by a selection inside this hunk, or a reason it cannot be used. */
  const rangeTarget = (range: Range): { target?: Target; error?: string } => {
    const codeAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".diff-code");
    const first = codeAt(range.startContainer), last = codeAt(range.endContainer);
    if (!first || !last || !container.current?.contains(first) || !container.current.contains(last)) return {};
    const side: LineSide = first.dataset.newLine ? "new" : "old";
    const attr = side === "new" ? "data-new-line" : "data-old-line";
    if (!first.hasAttribute(attr) || !last.hasAttribute(attr)) return {};
    const snippets = Array.from(container.current.querySelectorAll<HTMLElement>(`.diff-code[${attr}]`)).filter(code => range.intersectsNode(code)).map(code => {
      const part = document.createRange();
      part.selectNodeContents(code);
      if (code.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
      if (code.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
      return part.toString();
    });
    const text = snippets.join("\n");
    if (!text.trim()) return {};
    if (text.length > 8000) return { error: "Select a smaller code excerpt (up to 8,000 characters)." };
    if (text.length + text.split("\n").length * 2 + path.length + 100 > 18000) return { error: "Select a smaller code excerpt to leave room for your decision." };
    const line = Number(first.getAttribute(attr));
    const row = numbered.find(item => (side === "old" ? item.oldLine : item.newLine) === line);
    if (!row) return {};
    return { target: { side, line, endLine: Number(last.getAttribute(attr)), text: row.text.slice(1), selection: text } };
  };
  const openMenu = (code: HTMLElement, at: { x: number; y: number } | undefined, range?: Range) => {
    setSelectionError("");
    let target: Target | undefined;
    if (range) { const result = rangeTarget(range); if (result.error) setSelectionError(result.error); if (result.target && range.intersectsNode(code)) target = result.target; }
    target ??= lineTarget(code);
    if (!target) return;
    const box = code.getBoundingClientRect();
    setMenu({ x: at?.x ?? box.left + 24, y: at?.y ?? box.bottom, target, returnTo: code });
  };
  const anyControls = !!decisions;
  const closeMenu = (restore = true) => { const back = menu?.returnTo; setMenu(undefined); if (restore && back?.isConnected) back.focus({ preventScroll: true }); };
  const menuItems = (target: Target): DiffMenuItem[] => {
    const entry = (id: string, label: string, hint: string, controls: { enabled: boolean; busy: boolean } | undefined, run: () => void): DiffMenuItem[] =>
      controls ? [{ id, label, hint, run, ...(!controls.enabled ? { disabledReason: "Save this report to a project first" } : controls.busy ? { disabledReason: "Saving…" } : {}) }] : [];
    return [
      ...entry("decision", "Record a decision", "A judgement call you made", decisions, () => setDeciding(target)),
    ];
  };
  const lineDecisionItems = (oldLine?: number, newLine?: number) => (decisions?.decisions ?? []).filter((item) => item.status === "active" && item.anchors.some((anchor) =>
    anchor.type === "line" && anchor.anchor.file === path && (anchor.anchor.side === "old" ? anchor.anchor.line === oldLine : anchor.anchor.line === newLine)));
  const lineDecisions = (oldLine?: number, newLine?: number) => {
    if (!decisions) return null;
    const items = lineDecisionItems(oldLine, newLine);
    const composer = deciding && (deciding.side === "old" ? deciding.line === oldLine : deciding.line === newLine);
    if (!items.length && !composer) return null;
    return <div className="diff-line-questions diff-line-decisions">
      {items.map((item) => <DecisionCard key={item.id} item={item} controls={decisions} />)}
      {composer && <DecisionComposer label={`Decision on ${deciding.side === "old" ? "Before" : "After"} line ${deciding.line}`} busy={decisions.busy}
        anchors={[{ type: "line", file: path, side: deciding.side, line: deciding.line, expectedText: deciding.text }]} onSave={decisions.onCreate} onCancel={() => setDeciding(undefined)} />}
    </div>;
  };
  const activeTarget = menu?.target;
  const isActive = (side: LineSide, line?: number) => !!activeTarget && line !== undefined && activeTarget.side === side && line >= activeTarget.line && line <= (activeTarget.endLine ?? activeTarget.line);
  return <section ref={container} className="diff-hunk" aria-label={`Changes at line ${hunk.newStart}`} tabIndex={anyControls ? 0 : undefined}
    onMouseDown={(event) => {
      viaKeyboard.current = false;
      const secondary = event.button === 2 || (event.button === 0 && event.ctrlKey);
      const current = window.getSelection();
      selectionBefore.current = secondary && current && !current.isCollapsed && current.rangeCount ? current.getRangeAt(0).cloneRange() : undefined;
    }}
    onContextMenu={(event) => {
      if (!anyControls) return;
      const code = (event.target as Element).closest<HTMLElement>(".diff-code");
      if (!code || !container.current?.contains(code) || (!code.hasAttribute("data-old-line") && !code.hasAttribute("data-new-line"))) return;
      event.preventDefault();
      let range = selectionBefore.current;
      if (viaKeyboard.current) { const current = window.getSelection(); range = current && !current.isCollapsed && current.rangeCount ? current.getRangeAt(0) : undefined; }
      const fromKeyboard = viaKeyboard.current || (event.clientX === 0 && event.clientY === 0);
      openMenu(code, fromKeyboard ? undefined : { x: event.clientX, y: event.clientY }, range);
      viaKeyboard.current = false; selectionBefore.current = undefined;
    }}
    onKeyDown={(event) => {
      if (!anyControls || (event.target instanceof Element && event.target.closest("textarea,input,select,button,[role='menu']"))) return;
      const spans = () => Array.from(container.current?.querySelectorAll<HTMLElement>(".diff-code[data-old-line],.diff-code[data-new-line]") ?? []);
      const code = event.target instanceof Element ? event.target.closest<HTMLElement>(".diff-code") : null;
      if (event.target === event.currentTarget && (event.key === "ArrowDown" || event.key === "Enter")) { event.preventDefault(); spans()[0]?.focus(); return; }
      if (!code) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const attr = code.hasAttribute("data-new-line") ? "data-new-line" : "data-old-line";
        const sameSide = spans().filter((item) => item.hasAttribute(attr));
        sameSide[sameSide.indexOf(code) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
      } else if (event.key === "Enter" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        viaKeyboard.current = true;
        const current = window.getSelection();
        openMenu(code, undefined, current && !current.isCollapsed && current.rangeCount ? current.getRangeAt(0) : undefined);
        viaKeyboard.current = false;
      }
    }}>
    {menu && <DiffContextMenu x={menu.x} y={menu.y} onClose={() => closeMenu()} items={menuItems(menu.target)}
      title={`${path} · ${menu.target.side === "old" ? "Before" : "After"} ${menu.target.endLine && menu.target.endLine !== menu.target.line ? `lines ${menu.target.line}–${menu.target.endLine}` : `line ${menu.target.line}`}`} />}
    {selectionError && <p role="alert">{selectionError}</p>}
    <div id={id}>
      {layout === "split" ? <div className="diff-split">{heading}<div className="diff-row diff-column-head"><div>Before</div><div>After</div></div>
        {(expanded ? rows : rows.slice(0, PREVIEW_LINES)).map((row, i) => <Fragment key={i}><div className="diff-row">
          <Cell row={row} side="old" tokens={row.old?.line ? syntax.before.get(row.old.line) : undefined} active={isActive("old", row.old?.line)} />
          <Cell row={row} side="next" tokens={row.next?.line ? syntax.after.get(row.next.line) : undefined} active={isActive("new", row.next?.line)} />
        </div>{lineDecisions(row.old?.line, row.next?.line)}</Fragment>)}
      </div> : <div className="diff diff-inline">{heading}{(expanded ? numbered : numbered.slice(0, PREVIEW_LINES)).map((row, i) => <Fragment key={i}><div className={`diff-inline-line ${row.text[0] === "+" ? "a" : row.text[0] === "-" ? "d" : ""}`}>
        <span className={`diff-code${isActive("new", row.newLine) || isActive("old", row.oldLine) ? " diff-target" : ""}`} tabIndex={row.oldLine !== undefined || row.newLine !== undefined ? -1 : undefined} data-old-line={row.oldLine} data-new-line={row.newLine}><SyntaxText tokens={syntax.inline[i]} text={row.text} /></span>
      </div>{lineDecisions(row.oldLine, row.newLine)}</Fragment>)}</div>}
    </div>
    {remaining > 0 && <button type="button" className="diff-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer lines" : `Expand (${remaining} more ${layout === "split" ? "rows" : "lines"})`}</button>}
  </section>;
}

export interface DiffConfig { file?: FileDiff; flags: Flag[]; layout: DiffLayout; onLayout: (layout: DiffLayout) => void; decisions?: DecisionControls }
export function DiffView({ config }: { config: DiffConfig }) {
  const { file, flags, layout, onLayout } = config;
  const fileFlags = file ? flags.filter((flag) => flag.file === file.path) : [];
  if (!file) return <div className="empty">Select a file.</div>;
  return <>
    <div className="diff-heading"><h3>{file.path} <span className="loc">{file.status} · +{file.additions} −{file.deletions}</span></h3><div className="diff-layout" role="group" aria-label="Diff layout">
      <button type="button" data-layout="inline" aria-pressed={layout === "inline"} onClick={() => onLayout("inline")}>Inline</button>
      <button type="button" data-layout="split" aria-pressed={layout === "split"} onClick={() => onLayout("split")}>Side by side</button>
    </div></div>
    {config.decisions && <p className="loc diff-hint">Select code and right-click (or focus a line and press Enter) to record a decision.</p>}
    {fileFlags.length > 0 && <details className="file-flags"><summary>{fileFlags.length} {fileFlags.length === 1 ? "finding" : "findings"} in this file</summary>
      {fileFlags.map((flag, i) => <FlagRow key={i} flag={flag} />)}
    </details>}
    {file.hunks.length ? file.hunks.map((hunk, i) => <DiffHunk key={`${file.path}:${i}`} hunk={hunk} layout={layout} path={file.path} oldPath={file.oldPath} decisions={config.decisions} />) : <div className="empty">No textual hunks (binary or pure rename).</div>}
  </>;
}
