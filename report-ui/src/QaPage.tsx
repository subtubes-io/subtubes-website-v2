"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import type { QaStep, QaWalkthrough } from "./model/qa";
import { MAX_QA_NOTE } from "./model/qa";
import { AttachmentImage } from "./AttachmentImage";
import { IMAGE_ACCEPT, imageFiles, uploadImage } from "./attachments";
import { DeleteDialog } from "./DeleteDialog";
import { StepThumbnail, WalkthroughCarousel } from "./WalkthroughCarousel";
import { reportServices } from "./services";
import { ReportMarkdown } from "./ReportMarkdown";

/** What the steps of one walkthrough need. */
interface StepControls {
  steps: QaStep[]; enabled: boolean; busy: boolean; error: string;
  onAdd: (input: { image?: string; note?: string }) => Promise<QaStep[]>;
  onEdit: (step: QaStep, patch: { note?: string; image?: string | null }) => Promise<void>;
  onMove: (step: QaStep, toIndex: number) => Promise<void>;
  onRemove: (step: QaStep) => Promise<void>;
}

export interface QaControls {
  walkthroughs: QaWalkthrough[]; enabled: boolean; busy: boolean; error: string;
  onAddWalkthrough: (title: string) => Promise<QaWalkthrough[]>;
  onRenameWalkthrough: (walkthrough: QaWalkthrough, title: string) => Promise<void>;
  onRemoveWalkthrough: (walkthrough: QaWalkthrough, confirmation: string) => Promise<void>;
  onAdd: (walkthrough: QaWalkthrough, input: { image?: string; note?: string }) => Promise<QaStep[]>;
  onEdit: (walkthrough: QaWalkthrough, step: QaStep, patch: { note?: string; image?: string | null }) => Promise<void>;
  onMove: (walkthrough: QaWalkthrough, step: QaStep, toIndex: number) => Promise<void>;
  onRemove: (walkthrough: QaWalkthrough, step: QaStep) => Promise<void>;
}

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
/** A note as plain text for a thumbnail caption: Markdown marks are dropped. */
const plainNote = (note: string) => note.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>~-]+/g, " ").replace(/\s+/g, " ").trim();
const messageOf = (cause: unknown) => String(cause instanceof Error ? cause.message : cause);
export const qaSummary = (steps: QaStep[]) => {
  const shots = steps.filter((step) => step.image).length;
  return `${steps.length} ${steps.length === 1 ? "step" : "steps"} · ${shots} with ${shots === 1 ? "a screenshot" : "screenshots"}`;
};

function StepCard({ step, index, last, controls, files, onOpenFile, editing, setEditing }: {
  step: QaStep; index: number; last: boolean; controls: StepControls; files?: readonly string[]; onOpenFile?: (path: string) => void;
  editing: boolean; setEditing: (open: boolean) => void;
}) {
  const [note, setNote] = useState(step.note), [image, setImage] = useState<string | undefined>(step.image), [error, setError] = useState(""), [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const disabled = !controls.enabled || controls.busy;
  const number = index + 1;
  useEffect(() => { if (!editing) { setNote(step.note); setImage(step.image); setError(""); } }, [editing, step]);
  const run = async (work: () => Promise<void>) => { setError(""); try { await work(); } catch (cause) { setError(messageOf(cause)); } };
  const replace = async (list: File[]) => {
    const file = list[0];
    if (!file) return;
    setUploading(true);
    await run(async () => { try { setImage((await uploadImage(file)).hash); } finally { setUploading(false); } });
  };
  const save = () => run(async () => { await controls.onEdit(step, { note, image: image ?? null }); setEditing(false); });
  const shown = editing ? image : step.image;
  const author = step.recordedBy === "agent" ? `Recorded by ${step.agent ?? "an agent"}` : "Added by a reviewer";
  return <li className="qa-step" aria-label={`QA step ${number}`}>
    <article className="qa-card">
      <header><span className="qa-number" aria-hidden="true">{number}</span><span className="qa-author">{author} · {when(step.createdAt)}</span></header>
      {shown && <div className="qa-shot"><AttachmentImage hash={shown} alt={`QA step ${number} screenshot`} /></div>}
      {editing ? <div className="qa-edit">
        <label>Note (Markdown)<textarea rows={4} maxLength={MAX_QA_NOTE} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="qa-edit-actions">
          <input ref={picker} type="file" accept={IMAGE_ACCEPT} hidden aria-label={`Choose a screenshot for step ${number}`} tabIndex={-1}
            onChange={(event) => { const picked = imageFiles(event.currentTarget.files); event.currentTarget.value = ""; void replace(picked); }} />
          <button type="button" disabled={disabled || uploading} onClick={() => picker.current?.click()}>{image ? "Replace screenshot" : "Add a screenshot"}</button>
          {image && <button type="button" disabled={disabled} onClick={() => setImage(undefined)}>Remove screenshot</button>}
          <span className="qa-edit-spacer" />
          <button type="button" disabled={disabled} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="primary" disabled={disabled || uploading || (!note.trim() && !image)} onClick={() => void save()}>Save step</button>
        </div>
        {error && <p role="alert" className="qa-error">{error}</p>}
      </div>
        : <>
          {step.note.trim()
            ? <div className="qa-note"><ReportMarkdown config={{ text: step.note, files, onOpenFile }} /></div>
            : <p className="qa-note qa-note-empty">No note on this step.</p>}
          <footer>
            <button type="button" disabled={disabled} aria-label={`Edit step ${number}`} title="Edit this step" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden="true" /> Edit</button>
            <button type="button" disabled={disabled || index === 0} aria-label={`Move step ${number} earlier`} title="Move earlier" onClick={() => void run(() => controls.onMove(step, index - 1))}><ArrowLeft size={14} aria-hidden="true" /></button>
            <button type="button" disabled={disabled || last} aria-label={`Move step ${number} later`} title="Move later" onClick={() => void run(() => controls.onMove(step, index + 1))}><ArrowRight size={14} aria-hidden="true" /></button>
            <span className="qa-edit-spacer" />
            <button type="button" disabled={disabled} aria-label={`Delete step ${number}`} title="Delete this step" onClick={() => void run(async () => { if (await reportServices.ask("Delete this QA step?", { title: "Delete QA step", kind: "warning" })) await controls.onRemove(step); })}><Trash2 size={14} aria-hidden="true" /></button>
          </footer>
          {error && <p role="alert" className="qa-error">{error}</p>}
        </>}
    </article>
  </li>;
}

/** One walkthrough's steps: screenshots and notes in the order someone followed them, with the controls to add, edit, move and remove them. */
function WalkthroughEditor({ controls, files, onOpenFile, problems, setProblems }: {
  controls: StepControls; files?: readonly string[]; onOpenFile?: (path: string) => void; problems: string[]; setProblems: (problems: string[]) => void;
}) {
  const [editing, setEditing] = useState<string>(), [uploading, setUploading] = useState(false), [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const controlsRef = useRef(controls); controlsRef.current = controls;
  const { steps, enabled } = controls;
  const add = async (list: File[]) => {
    if (!list.length || !controlsRef.current.enabled) return;
    setUploading(true); setProblems([]);
    const failed: string[] = [];
    let created: QaStep[] = [];
    for (const file of list) {
      try { created = await controlsRef.current.onAdd({ image: (await uploadImage(file)).hash }); }
      catch (cause) { failed.push(messageOf(cause)); }
    }
    setUploading(false); setProblems(failed);
    // A single new screenshot opens its note straight away, since a step is a picture plus what happened.
    if (list.length === 1 && !failed.length && created.length) setEditing(created[created.length - 1].id);
  };
  const addNote = async () => {
    setProblems([]);
    try { const created = await controls.onAdd({ note: "" }); setEditing(created[created.length - 1].id); }
    catch (cause) { setProblems([messageOf(cause)]); }
  };
  // Pasted screenshots become steps, unless the paste is into a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const pasted = imageFiles(event.clipboardData?.files);
      if (pasted.length) { event.preventDefault(); void add(pasted); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  return <>
    <ol className="qa-flow" aria-label="QA steps">
      {steps.map((step, index) => <StepCard key={step.id} step={step} index={index} last={index === steps.length - 1} controls={controls} files={files} onOpenFile={onOpenFile}
        editing={editing === step.id} setEditing={(open) => setEditing(open ? step.id : undefined)} />)}
      <li className="qa-add">
        <div className={`qa-drop${over ? " over" : ""}`}
          onDragOver={(event) => { if (enabled && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); void add(imageFiles(event.dataTransfer.files)); }}>
          <ImagePlus size={28} aria-hidden="true" />
          <strong>{steps.length ? "Add the next step" : "Add the first step"}</strong>
          <span>Drop or paste screenshots, or choose them. Each image becomes a step.</span>
          <input ref={picker} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Choose screenshots to add as QA steps" tabIndex={-1}
            onChange={(event) => { const picked = imageFiles(event.currentTarget.files); event.currentTarget.value = ""; void add(picked); }} />
          <div className="qa-drop-actions">
            <button type="button" className="primary" disabled={!enabled || controls.busy || uploading} onClick={() => picker.current?.click()}>Add screenshots</button>
            <button type="button" disabled={!enabled || controls.busy || uploading} onClick={() => void addNote()}>Add a note step</button>
          </div>
          <span role="status" className="attach-status">{uploading ? "Adding screenshots…" : ""}</span>
        </div>
      </li>
    </ol>
  </>;
}

/** A walkthrough as a reader sees it: a compact storyboard of thumbnails. Selecting one opens the walkthrough as a carousel at full size. */
export function WalkthroughView({ walkthrough, files, onOpenFile }: { walkthrough: QaWalkthrough; files?: readonly string[]; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState<number>();
  return <>
    <ol className="storyboard" aria-label={`QA steps: ${walkthrough.title}`}>
      {walkthrough.steps.map((step, index) => <li className="storyboard-step" key={step.id} aria-label={`QA step ${index + 1}`}>
        <button type="button" className="storyboard-open" aria-label={`Open step ${index + 1} of ${walkthrough.title}`} aria-haspopup="dialog" onClick={() => setOpen(index)}
          title={`${step.recordedBy === "agent" ? `Recorded by ${step.agent ?? "an agent"}` : "Added by a reviewer"} · ${when(step.createdAt)}`}>
          <span className="storyboard-number" aria-hidden="true">{index + 1}</span>
          {step.image && <span className="storyboard-shot"><StepThumbnail hash={step.image} alt={`${walkthrough.title}, step ${index + 1} screenshot`} /></span>}
          {step.note.trim() && <span className={`storyboard-note${step.image ? "" : " storyboard-note-only"}`}>{plainNote(step.note)}</span>}
        </button>
      </li>)}
    </ol>
    {open !== undefined && <WalkthroughCarousel walkthrough={walkthrough} start={open} onClose={() => setOpen(undefined)} files={files} onOpenFile={onOpenFile} />}
  </>;
}

/** The QA chapter: build any number of named walkthroughs showing how the change was exercised. */
export function QaPage({ controls, onRefresh, files, onOpenFile }: { controls: QaControls; onRefresh: () => Promise<void>; files?: readonly string[]; onOpenFile?: (path: string) => void }) {
  const { walkthroughs, enabled } = controls;
  const [selectedId, setSelectedId] = useState<string>(), [creating, setCreating] = useState(false), [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(""), [problems, setProblems] = useState<string[]>([]), [deleting, setDeleting] = useState(false);
  const selected = walkthroughs.find((item) => item.id === selectedId) ?? walkthroughs[0];
  const run = async (work: () => Promise<void>) => { setProblems([]); try { await work(); } catch (cause) { setProblems([messageOf(cause)]); } };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    void run(async () => {
      const next = await controls.onAddWalkthrough(title.trim());
      setSelectedId(next[next.length - 1].id); setCreating(false); setTitle("");
    });
  };
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !title.trim()) return;
    void run(async () => { await controls.onRenameWalkthrough(selected, title.trim()); setRenaming(false); setTitle(""); });
  };
  const stepControls: StepControls | undefined = selected && {
    steps: selected.steps, enabled, busy: controls.busy, error: "",
    onAdd: (input) => controls.onAdd(selected, input).then((steps) => steps),
    onEdit: (step, patch) => controls.onEdit(selected, step, patch),
    onMove: (step, toIndex) => controls.onMove(selected, step, toIndex),
    onRemove: (step) => controls.onRemove(selected, step),
  };
  const allSteps = walkthroughs.reduce((count, item) => count + item.steps.length, 0);
  const nameForm = (submit: (event: FormEvent) => void, label: string, action: string, cancel: () => void) =>
    <form className="qa-title-form" onSubmit={submit} aria-label={label}>
      <input aria-label="Walkthrough title" autoFocus required maxLength={120} placeholder="Name this walkthrough, for example Checkout on mobile" value={title} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit" className="primary" disabled={!enabled || controls.busy || !title.trim()}>{action}</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </form>;
  return <section className="questions-page qa-page" aria-label="QA walkthroughs">
    <div className="questions-heading"><div><h2>QA</h2>
      <p>{walkthroughs.length ? `${walkthroughs.length} ${walkthroughs.length === 1 ? "walkthrough" : "walkthroughs"} · ${allSteps} ${allSteps === 1 ? "step" : "steps"}. ` : "No QA is recorded for this change yet. "}Show how the feature was exercised: build a walkthrough for each flow, with screenshots in the order someone follows them and a Markdown note for each step. They appear on the report Summary.</p></div>
      <div className="question-actions"><button type="button" disabled={!enabled || controls.busy} onClick={() => { void onRefresh(); }}>Refresh QA</button></div></div>
    {!enabled && <p role="status">Save this report to a project to record QA.</p>}
    {(controls.error || problems.length > 0) && <div role="alert" className="qa-error">{[controls.error, ...problems].filter(Boolean).map((message, index) => <p key={index}>{message}</p>)}</div>}
    <div className="qa-walkthroughs">
      <div className="qa-walkthrough-tabs" role="tablist" aria-label="Walkthroughs">
        {walkthroughs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={selected?.id === item.id} className={selected?.id === item.id ? "on" : ""} onClick={() => { setSelectedId(item.id); setRenaming(false); setCreating(false); }}>{item.title}</button>)}
        <button type="button" className="qa-new-walkthrough" disabled={!enabled || controls.busy || walkthroughs.length >= 20} onClick={() => { setCreating(true); setRenaming(false); setTitle(""); }}><Plus size={14} aria-hidden="true" /> New walkthrough</button>
      </div>
      {creating && nameForm(create, "New walkthrough", "Create walkthrough", () => setCreating(false))}
      {!creating && !selected && <p className="loc">Create a walkthrough to start adding steps.</p>}
    </div>
    {selected && !creating && <>
      <div className="qa-walkthrough-head">
        {renaming ? nameForm(rename, "Rename walkthrough", "Save name", () => setRenaming(false)) : <>
          <h3>{selected.title}</h3>
          <span className="loc">{qaSummary(selected.steps)}{selected.steps.length ? ` · last updated ${when(selected.updatedAt)}` : ""}</span>
          <span className="qa-edit-spacer" />
          <button type="button" disabled={!enabled || controls.busy} aria-label={`Rename walkthrough ${selected.title}`} onClick={() => { setRenaming(true); setTitle(selected.title); }}><Pencil size={14} aria-hidden="true" /> Rename</button>
          <button type="button" className="danger" disabled={!enabled || controls.busy} aria-label={`Delete walkthrough ${selected.title}`} onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
        </>}
      </div>
      <WalkthroughEditor key={selected.id} controls={stepControls!} files={files} onOpenFile={onOpenFile} problems={problems} setProblems={setProblems} />
    </>}
    {deleting && selected && <DeleteDialog config={{ kind: "walkthrough", name: selected.title, consequence: ` and its ${selected.steps.length} ${selected.steps.length === 1 ? "step" : "steps"}`,
      onCancel: () => setDeleting(false), onConfirm: async (confirmation) => { await controls.onRemoveWalkthrough(selected, confirmation); setDeleting(false); setSelectedId(undefined); } }} />}
  </section>;
}
