import type { ClipboardEvent, DragEvent } from "react";
import { reportServices } from "./services";
import { attachmentMarkdown, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, type Attachment } from "./model/attachments";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
export const IMAGE_LIMIT_HINT = "PNG, JPEG, WebP or GIF. Saved images: 2 MiB maximum, 16,384 pixels per side. Larger still images are optimized locally.";
export const MAX_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024;
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
  if (!file.size) return "The image is empty.";
  if (file.size > MAX_IMAGE_SOURCE_BYTES) return "Choose an image no larger than 20 MiB for local processing.";
  return undefined;
}

export async function prepareImage(file: File): Promise<File> {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  if (file.size <= MAX_IMAGE_BYTES) return file;
  // Re-encoding animation as a still frame would silently lose report content.
  const header = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("latin1").decode(header);
  const actualType = header[0] === 0x89 && text.slice(1, 4) === "PNG" ? "image/png"
    : header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff ? "image/jpeg"
    : /^GIF8[79]a/.test(text) ? "image/gif"
    : text.startsWith("RIFF") && text.slice(8, 12) === "WEBP" ? "image/webp" : undefined;
  if (actualType !== file.type) throw new Error("Image bytes do not match the selected PNG, JPEG, WebP or GIF type.");
  if (file.type === "image/gif" || (file.type === "image/png" && text.includes("acTL")) ||
    (file.type === "image/webp" && text.includes("ANIM"))) {
    throw new Error("Animated images larger than 2 MiB cannot be optimized without losing frames. Choose a smaller animation or an explicit still image.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The image could not be decoded for local optimization."));
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > MAX_IMAGE_SIDE ||
      image.naturalHeight > MAX_IMAGE_SIDE || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error("The source image exceeds local processing limits (16,384 pixels per side, 40 million pixels).");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image optimization is unavailable on this computer.");
    const initialScale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    for (const factor of [1, 0.85, 0.7]) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * initialScale * factor));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * initialScale * factor));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of [["image/png", undefined], ["image/webp", 0.92], ["image/webp", 0.85]] as const) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob) throw new Error("The optimized image could not be encoded.");
        if (blob.size <= MAX_IMAGE_BYTES) {
          const extension = blob.type === "image/webp" ? "webp" : "png";
          return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "image"}.${extension}`, { type: blob.type });
        }
      }
    }
    throw new Error("This image cannot fit within 2 MiB at the supported quality levels. Crop it or choose a smaller image.");
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadImage(file: File): Promise<Attachment> {
  const prepared = await prepareImage(file);
  const { attachment } = await reportServices.attachments({ action: "add", filename: prepared.name || "image", data: await toBase64(prepared) });
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
