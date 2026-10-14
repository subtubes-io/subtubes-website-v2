import sharp, { type Metadata } from "sharp";
import { DocumentError } from "./document-compatibility";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16384;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export async function readImageBody(request: Request): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    throw new DocumentError(422, "invalid_document", "Invalid Content-Length.");
  }
  if (length !== null && Number(length) > MAX_IMAGE_BYTES) {
    await request.body?.cancel();
    throw new DocumentError(413, "too_large", "Images must be at most 2 MiB.");
  }
  if (!request.body) throw new DocumentError(422, "invalid_document", "An image body is required.");
  return readImageStream(request.body);
}

export async function readImageStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new DocumentError(413, "too_large", "Images must be at most 2 MiB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function validateImage(bytes: Buffer, contentType: string) {
  if (!bytes.length) throw new DocumentError(422, "invalid_document", "The image is empty.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new DocumentError(413, "too_large", "Images must be at most 2 MiB.");
  if (!IMAGE_TYPES.some((type) => type === contentType)) {
    throw new DocumentError(422, "invalid_document", "Only PNG, JPEG, WebP and GIF images are supported.");
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: MAX_IMAGE_SIDE * MAX_IMAGE_SIDE, animated: false }).metadata();
  } catch (cause) {
    throw new DocumentError(422, "invalid_document", `The image cannot be inspected: ${cause instanceof Error ? cause.message : "invalid image"}`);
  }
  const expected = contentType === "image/jpeg" ? "jpeg" : contentType.slice(6);
  if (metadata.format !== expected || !metadata.width || !metadata.height ||
    metadata.width > MAX_IMAGE_SIDE || metadata.height > MAX_IMAGE_SIDE) {
    throw new DocumentError(422, "invalid_document", "Image bytes must match the declared type and be at most 16,384 pixels per side.");
  }
  return { width: metadata.width, height: metadata.height };
}
