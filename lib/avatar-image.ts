import sharp from "sharp";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function prepareAvatar(file: File) {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw new Error("Avatar images must be between 1 byte and 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const image = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
  const metadata = await image.metadata();
  const expected = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[file.type];
  if (metadata.format !== expected || (metadata.pages ?? 1) > 1) {
    throw new Error("Choose a non-animated PNG, JPEG, or WebP image.");
  }
  return image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
}
