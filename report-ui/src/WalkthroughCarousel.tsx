"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { QaWalkthrough } from "./model/qa";
import { attachmentUrl } from "./attachments";
import { ReportMarkdown } from "./ReportMarkdown";

/** A stored image's displayable address, or why it cannot be shown. */
export function useAttachmentUrl(hash: string | undefined) {
  const [state, setState] = useState<{ url?: string; error?: boolean }>({});
  useEffect(() => {
    if (!hash) { setState({}); return; }
    let current = true;
    setState({});
    attachmentUrl(hash).then((url) => { if (current) setState({ url }); }, () => { if (current) setState({ error: true }); });
    return () => { current = false; };
  }, [hash]);
  return state;
}

/** A small picture of a step's screenshot. It is not a control; the card that holds it opens the carousel. */
export function StepThumbnail({ hash, alt }: { hash: string; alt: string }) {
  const { url, error } = useAttachmentUrl(hash);
  if (error) return <span className="attachment-missing" role="img" aria-label={`Image unavailable: ${alt}`}>Image unavailable</span>;
  if (!url) return <span className="attachment-loading" role="status">Loading image…</span>;
  return <img src={url} alt={alt} draggable={false} />;
}

function Slide({ walkthrough, index, files, onOpenFile }: { walkthrough: QaWalkthrough; index: number; files?: readonly string[]; onOpenFile?: (path: string) => void }) {
  const step = walkthrough.steps[index];
  const { url, error } = useAttachmentUrl(step.image);
  return <figure className="carousel-slide">
    {step.image && (error ? <p className="attachment-missing" role="img" aria-label="Image unavailable">Image unavailable</p>
      : url ? <img src={url} alt={`${walkthrough.title}, step ${index + 1} screenshot`} /> : <p className="attachment-loading" role="status">Loading image…</p>)}
    {step.note.trim() && <figcaption className="carousel-note"><ReportMarkdown config={{ text: step.note, files, onOpenFile }} /></figcaption>}
  </figure>;
}

/** A walkthrough at full size: one step at a time, with the arrows or the arrow keys to move along it. */
export function WalkthroughCarousel({ walkthrough, start, onClose, files, onOpenFile }: {
  walkthrough: QaWalkthrough; start: number; onClose: () => void; files?: readonly string[]; onOpenFile?: (path: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const count = walkthrough.steps.length;
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(count - 1, 0)));
  const close = useRef(onClose); close.current = onClose;
  const go = (next: number) => setIndex((current) => Math.min(Math.max(next, 0), count - 1) === current ? current : Math.min(Math.max(next, 0), count - 1));
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  if (!count) return null;
  return createPortal(<dialog ref={dialog} className="attachment-viewer walkthrough-carousel" aria-label={`Walkthrough: ${walkthrough.title}`} aria-roledescription="carousel"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close.current(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close.current(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      else if (event.key === "Home") { event.preventDefault(); go(0); }
      else if (event.key === "End") { event.preventDefault(); go(count - 1); }
    }}>
    <button type="button" className="attachment-viewer-close" aria-label="Close walkthrough" autoFocus onClick={() => close.current()}><X size={18} aria-hidden="true" /></button>
    <div className="carousel-head"><strong>{walkthrough.title}</strong><span role="status" aria-live="polite">Step {index + 1} of {count}</span></div>
    <div className="carousel-stage">
      <button type="button" className="carousel-arrow" aria-label="Previous step" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={22} aria-hidden="true" /></button>
      <div className="carousel-slide-host" role="group" aria-roledescription="slide" aria-label={`Step ${index + 1} of ${count}`}>
        <Slide key={walkthrough.steps[index].id} walkthrough={walkthrough} index={index} files={files} onOpenFile={onOpenFile} />
      </div>
      <button type="button" className="carousel-arrow" aria-label="Next step" disabled={index === count - 1} onClick={() => go(index + 1)}><ChevronRight size={22} aria-hidden="true" /></button>
    </div>
    <div className="carousel-dots" role="group" aria-label="Steps">
      {walkthrough.steps.map((step, position) => <button key={step.id} type="button" className={position === index ? "on" : ""} aria-label={`Go to step ${position + 1}`} aria-current={position === index ? "true" : undefined} onClick={() => go(position)} />)}
    </div>
  </dialog>, document.body);
}
