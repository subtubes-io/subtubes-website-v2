import { z } from "zod/v3";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16384;
/** Base64 of a maximum-size image plus the JSON around it. */
export const MAX_ATTACHMENT_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4096;

export const attachmentHash = z.string().regex(/^[a-f0-9]{64}$/, "An attachment hash is 64 lowercase hex characters.");
export const imageMime = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export type ImageMime = z.infer<typeof imageMime>;

export const attachment = z.object({
  hash: attachmentHash, mime: imageMime, bytes: z.number().int().positive(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  filename: z.string().min(1).max(255), createdAt: z.string().datetime(),
}).strict();
export type Attachment = z.infer<typeof attachment>;

const filename = z.string().trim().min(1).max(255);
export const attachmentRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), filename, data: z.string().min(1).describe("Base64 image bytes.") }).strict(),
  z.object({ action: z.literal("add_file"), path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal("get"), hash: attachmentHash }).strict(),
]);
export type AttachmentRequest = z.infer<typeof attachmentRequest>;

export interface AttachmentResult { attachment: Attachment; data?: string }

/** The Markdown that embeds an attachment. */
export const attachmentMarkdown = (item: Pick<Attachment, "hash">, alt: string) =>
  `![${alt.replace(/[[\]\\\r\n]/g, " ").trim().slice(0, 200) || "image"}](attachment:${item.hash})`;
