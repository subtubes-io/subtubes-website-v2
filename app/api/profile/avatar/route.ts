import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { MAX_AVATAR_BYTES, prepareAvatar } from "@/lib/avatar-image";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to upload an avatar." }, { status: 401 });
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin || request.headers.get("origin") !== new URL(origin).origin) {
    return Response.json({ error: "This upload must come from this website." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    return Response.json({ error: "Send an image using multipart form data." }, { status: 400 });
  }

  // Bound streamed bodies too, not just the untrusted Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AVATAR_BYTES + 16_384) {
      await reader.cancel();
      return Response.json({ error: "Avatar images must be at most 2 MB." }, { status: 413 });
    }
    chunks.push(value);
  }
  let file: File;
  let image: Buffer;
  try {
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
    const entry = form.get("avatar");
    if (!(entry instanceof File)) throw new Error("Choose an image to upload.");
    file = entry;
    image = await prepareAvatar(file);
  } catch (error) {
    console.warn("Avatar validation failed", error instanceof Error ? error.message : "Invalid image");
    return Response.json({ error: "Choose a valid, non-animated PNG, JPEG, or WebP image up to 2 MB and 16 megapixels." }, { status: 400 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Avatar storage is not configured: BLOB_READ_WRITE_TOKEN is missing.");
    return Response.json({ error: "Avatar storage is not configured. Please contact the site administrator." }, { status: 503 });
  }
  let uploadedUrl: string | undefined;
  try {
    const blob = await put(`avatars/${session.user.id}/${randomUUID()}.webp`, image, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    uploadedUrl = blob.url;
    await auth.api.updateUser({ headers: request.headers, body: { image: blob.url } });
    return Response.json({ image: blob.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Avatar upload failed", error);
    if (uploadedUrl) {
      try {
        await del(uploadedUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
      } catch (cleanupError) {
        console.error("Unable to remove failed avatar upload", cleanupError);
      }
    }
    return Response.json({ error: "Could not save your avatar. Please try again." }, { status: 500 });
  }
}
