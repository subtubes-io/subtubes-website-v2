"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { attachmentUrl } from "./attachments";

/** A stored image shown inline; selecting it opens it at full size. */
export function AttachmentImage({ hash, alt }: { hash: string; alt: string }) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let current = true;
    setState({});
    attachmentUrl(hash).then((url) => { if (current) setState({ url }); }, (error: unknown) => { if (current) setState({ error: String(error) }); });
    return () => { current = false; };
  }, [hash]);
  const label = alt.trim() || "image";
  if (state.error) return <span className="attachment-missing" role="img" aria-label={`Image unavailable: ${label}`} title={state.error}>Image unavailable: {label}</span>;
  if (!state.url) return <span className="attachment-loading" role="status">Loading image…</span>;
  return <>
    <button type="button" ref={opener} className="attachment-thumb" aria-label={`Enlarge image: ${label}`} aria-haspopup="dialog"
      onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      <img src={state.url} alt={alt} draggable={false} />
    </button>
    {open && <AttachmentViewer url={state.url} alt={label} onClose={() => { setOpen(false); opener.current?.focus({ preventScroll: true }); }} />}
  </>;
}

function AttachmentViewer({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  // A modal dialog of its own, on the body: it stacks above the design drawer that holds the image.
  return createPortal(<dialog ref={dialog} className="attachment-viewer" aria-label={`Image: ${alt}`}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close.current(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close.current(); }}
    onKeyDown={(event) => event.stopPropagation()}>
    <button type="button" className="attachment-viewer-close" aria-label="Close image" autoFocus onClick={() => close.current()}><X size={18} aria-hidden="true" /></button>
    <img src={url} alt={alt} />
  </dialog>, document.body);
}
