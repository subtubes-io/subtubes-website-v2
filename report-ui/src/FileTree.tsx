"use client";
import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { FileDiff } from "./model/types";

export interface TreeState { query: string; collapsed: Set<string> }
interface Directory { directories: Map<string, Directory>; files: FileDiff[] }
export function buildTree(files: FileDiff[]) {
  const root: Directory = { directories: new Map(), files: [] };
  for (const file of files) {
    let directory = root;
    for (const part of file.path.split("/").slice(0, -1)) {
      let child = directory.directories.get(part);
      if (!child) { child = { directories: new Map(), files: [] }; directory.directories.set(part, child); }
      directory = child;
    }
    directory.files.push(file);
  }
  return root;
}

interface TreeConfig { files: FileDiff[]; selected: string; onSelect: (path: string) => void; state: TreeState; setState: Dispatch<SetStateAction<TreeState>>; decisionCounts?: ReadonlyMap<string, number> }
export function FileTree({ config }: { config: TreeConfig }) {
  const { files, selected, onSelect, state, setState } = config;
  const nav = useRef<HTMLElement>(null);
  const searching = !!state.query.trim();
  useLayoutEffect(() => {
    // Native details can toggle before its event updates React's previous open prop.
    nav.current?.querySelectorAll<HTMLDetailsElement>("details").forEach((folder) => {
      folder.open = !!state.query.trim() || !state.collapsed.has(folder.dataset.folder!);
    });
  }, [state.query, state.collapsed]);
  const matches = files.filter((file) => file.path.toLowerCase().includes(state.query.trim().toLowerCase()));
  const capture = () => {
    const collapsed = new Set(state.collapsed);
    if (!searching) nav.current?.querySelectorAll<HTMLDetailsElement>("details").forEach((folder) => {
      const path = folder.dataset.folder!;
      if (folder.open) collapsed.delete(path); else collapsed.add(path);
    });
    return collapsed;
  };
  const renderDirectory = (directory: Directory, prefix: string): React.ReactNode => <>
    {[...directory.directories].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      const path = `${prefix}${name}/`;
      return <details key={path} className="diff-folder" data-folder={path} open={searching || !state.collapsed.has(path)} onToggle={(e) => {
        if (searching) return;
        const open = e.currentTarget.open;
        setState((current) => {
          if (current.query.trim() || current.collapsed.has(path) === !open) return current;
          const collapsed = new Set(current.collapsed);
          if (open) collapsed.delete(path); else collapsed.add(path);
          return { ...current, collapsed };
        });
      }}><summary title={path}>{name}</summary><div className="diff-folder-children">{renderDirectory(child, path)}</div></details>;
    })}
    {[...directory.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => <button key={file.path} type="button" className={`diff-file${file.path === selected ? " sel" : ""}`} title={file.path} aria-label={`${file.path}, ${file.status}, ${file.additions} additions, ${file.deletions} deletions${file.reviewed === true ? ", approved" : ""}${config.decisionCounts?.get(file.path) ? `, ${config.decisionCounts.get(file.path)} ${config.decisionCounts.get(file.path) === 1 ? "decision" : "decisions"}` : ""}`} aria-current={file.path === selected ? "true" : undefined} onClick={() => {
      setState({ ...state, collapsed: capture() });
      onSelect(file.path);
    }}><span className="diff-file-path">{file.path.split("/").pop()}</span><span className="loc">{file.status} · +{file.additions} −{file.deletions}</span>{file.reviewed === true && <span className="file-approved">Approved</span>}{!!config.decisionCounts?.get(file.path) && <span className="file-decisions" title="Recorded decisions">{config.decisionCounts.get(file.path)} {config.decisionCounts.get(file.path) === 1 ? "decision" : "decisions"}</span>}</button>)}
  </>;
  return <>
    <h3>Changed files ({files.length})</h3>
    <input type="search" className="diff-file-search" placeholder="Search changed files..." aria-label="Search changed files" spellCheck={false} value={state.query} onChange={(e) => setState({ query: e.target.value, collapsed: capture() })} />
    <div className="loc diff-search-count" role="status" hidden={!searching}>{matches.length} of {files.length} files</div>
    <nav ref={nav} className="diff-file-tree" aria-label="Changed files">{renderDirectory(buildTree(matches), "")}{!matches.length && <div className="loc">{searching ? "No changed files match your search." : "No changed files."}</div>}</nav>
  </>;
}
