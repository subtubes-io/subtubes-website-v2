"use client";
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlus } from "lucide-react";
import { IMAGE_ACCEPT, IMAGE_LIMIT_HINT, hasImageFiles, imageFiles, insertBlock, markdownFor, uploadImage } from "./attachments";

interface Options { value: string; onChange: (value: string) => void; maxLength?: number; disabled?: boolean }

/** Paste, drop or pick images for a Markdown textarea. Each image is stored and its Markdown is inserted at the caret. */
export function useImageAttach({ value, onChange, maxLength = 20000, disabled }: Options) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(value); latest.current = value;
  const caret = useRef<{ start: number; end: number } | undefined>(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const writing = useRef(false);

  const remember = (element: HTMLTextAreaElement) => { caret.current = { start: element.selectionStart, end: element.selectionEnd }; };
  const attach = async (files: File[]) => {
    if (!files.length || disabled || writing.current) return;
    writing.current = true;
    setError(""); setBusy(true);
    try {
      for (const file of files) {
        const item = await uploadImage(file);
        const at = caret.current ?? { start: latest.current.length, end: latest.current.length };
        const next = insertBlock(latest.current, markdownFor(item, file.name || "image"), Math.min(at.start, latest.current.length), Math.min(at.end, latest.current.length));
        if (next.value.length > maxLength) throw new Error(`There is no room for another image: the text is limited to ${maxLength.toLocaleString()} characters.`);
        latest.current = next.value; caret.current = { start: next.caret, end: next.caret };
        onChange(next.value);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { writing.current = false; setBusy(false); }
  };

  const textareaProps = {
    ref: area,
    onSelect: (event: React.SyntheticEvent<HTMLTextAreaElement>) => remember(event.currentTarget),
    onBlur: (event: React.FocusEvent<HTMLTextAreaElement>) => remember(event.currentTarget),
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (!hasImageFiles(event)) return;
      event.preventDefault(); remember(event.currentTarget);
      void attach(imageFiles(event.clipboardData.files));
    },
    onDragOver: (event: DragEvent<HTMLTextAreaElement>) => { if (hasImageFiles(event)) event.preventDefault(); },
    onDrop: (event: DragEvent<HTMLTextAreaElement>) => {
      if (!hasImageFiles(event)) return;
      event.preventDefault(); remember(event.currentTarget);
      void attach(imageFiles(event.dataTransfer.files));
    },
  };

  const controls = <div className="attach-controls">
    <button type="button" disabled={disabled || busy} onClick={() => picker.current?.click()}><ImagePlus size={14} aria-hidden="true" /> Add image</button>
    <input ref={picker} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Choose images to attach" tabIndex={-1}
      onChange={(event) => { const files = imageFiles(event.currentTarget.files); event.currentTarget.value = ""; void attach(files); }} />
    <span className="attach-hint">Paste or drop. {IMAGE_LIMIT_HINT}</span>
    <span role="status" className="attach-status">{busy ? "Adding image…" : ""}</span>
    {error && <span role="alert" className="attach-error">{error}</span>}
  </div>;
  return { textareaProps, controls, busy, error };
}
