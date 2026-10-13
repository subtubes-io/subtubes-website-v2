"use client";
import { AttachmentImage } from "./AttachmentImage";
import { useImageAttach } from "./useImageAttach";

const IMAGE = /!\[([^\]]*)\]\(attachment:([a-f0-9]{64})\)/g;

/** The images a text embeds, once each, in order. */
export const embeddedImages = (text: string) => {
  const seen = new Map<string, string>();
  for (const [, alt, hash] of text.matchAll(IMAGE)) if (!seen.has(hash)) seen.set(hash, alt);
  return Array.from(seen, ([hash, alt]) => ({ hash, alt }));
};
export const withoutImage = (text: string, hash: string) =>
  text.replace(new RegExp(`\\n?!\\[[^\\]]*\\]\\(attachment:${hash}\\)\\n?`, "g"), "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");

/** A Markdown textarea that takes pasted, dropped or chosen images and shows the ones it holds. */
export function MarkdownImageField({ label, value, onChange, rows, maxLength = 20000, disabled }: {
  label: string; value: string; onChange: (value: string) => void; rows: number; maxLength?: number; disabled?: boolean;
}) {
  const attach = useImageAttach({ value, onChange, maxLength, disabled });
  const images = embeddedImages(value);
  return <div className="markdown-field">
    <label>{label}<textarea {...attach.textareaProps} maxLength={maxLength} rows={rows} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>
    {attach.controls}
    {!!images.length && <ul className="attachment-strip" aria-label={`Images in ${label.toLowerCase()}`}>
      {images.map((image) => <li key={image.hash}>
        <AttachmentImage hash={image.hash} alt={image.alt} />
        <button type="button" disabled={disabled} aria-label={`Remove image: ${image.alt || "image"}`} onClick={() => onChange(withoutImage(value, image.hash))}>Remove</button>
      </li>)}
    </ul>}
  </div>;
}
