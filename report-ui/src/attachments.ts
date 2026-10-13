import type { ClipboardEvent, DragEvent } from "react";
import { reportServices } from "./services";
import { attachmentMarkdown, MAX_IMAGE_BYTES, type Attachment } from "./model/attachments";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
const REFERENCE = /^attachment:([a-f0-9]{64})$/;

/** The hash in an `attachment:<hash>` address, if it is one. */
export const attachmentHash = (url: string | undefined) => url ? REFERENCE.exec(url)?.[1] : undefined;

function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "image/webp";
}

const urls = new Map<string, Promise<string>>();
/** A displayable address for a stored image. Each image is read once per window. */
export function attachmentUrl(hash: string): Promise<string> {
  let found = urls.get(hash);
  if (!found) {
    found = reportServices.attachmentBytes(hash).then((raw) => {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw as ArrayLike<number>);
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageType(bytes) }));
    });
    found.catch(() => urls.delete(hash));
    urls.set(hash, found);
  }
  return found;
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the image."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/** Checks the obvious problems before sending; the runtime checks the bytes again. */
export function imageProblem(file: File) {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name || "This file"} is not a PNG, JPEG, WebP or GIF image.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name || "This image"} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
  return undefined;
}

export async function uploadImage(file: File): Promise<Attachment> {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  const { attachment } = await reportServices.attachments({ action: "add", filename: file.name || "image", data: await toBase64(file) });
  return attachment;
}

export const imageFiles = (files: FileList | File[] | null | undefined) =>
  Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));

export const hasImageFiles = (event: ClipboardEvent | DragEvent) => {
  const data = "clipboardData" in event ? event.clipboardData : event.dataTransfer;
  return imageFiles(data?.files).length > 0 || Array.from(data?.items ?? []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
};

/** Inserts text where the caret is, as its own paragraph so Markdown shows an image on a line of its own. */
export function insertBlock(value: string, text: string, start: number, end: number) {
  const before = value.slice(0, start), after = value.slice(end);
  const gap = (side: string, edge: "end" | "start") => {
    if (!side) return "";
    const newlines = (edge === "end" ? /\n*$/ : /^\n*/).exec(side)![0].length;
    return "\n".repeat(Math.max(0, 2 - newlines));
  };
  const inserted = `${gap(before, "end")}${text}${gap(after, "start")}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

export const markdownFor = (attachment: Attachment, name: string) => attachmentMarkdown(attachment, name.replace(/\.[^.]+$/, ""));
