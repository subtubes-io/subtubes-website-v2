import { get } from "@vercel/blob";
import { DocumentError } from "./document-compatibility";
import { readImageStream } from "./images";

export function reportStorageToken(): string {
  const token = process.env.REPORT_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new DocumentError(503, "storage_unavailable", "Private report image storage is not configured.");
  return token;
}

export async function readPrivateImage(storagePath: string): Promise<Buffer> {
  const result = await get(storagePath, { access: "private", token: reportStorageToken(), useCache: false });
  if (!result || result.statusCode !== 200) throw new DocumentError(422, "missing_blobs", "The uploaded image is not available in private storage.");
  return readImageStream(result.stream);
}

export async function storedImageBytes(blob: { data: Buffer | null; storagePath: string | null }) {
  if (blob.data !== null) return blob.data;
  if (blob.storagePath) return readPrivateImage(blob.storagePath);
  throw new DocumentError(422, "invalid_document", "Image storage metadata is invalid.");
}
