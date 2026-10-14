import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { normalizeSha256 } from "@/lib/cloud-push/common";
import { storedImageBytes } from "@/lib/cloud-push/blob-storage";
import { DocumentError } from "@/lib/cloud-push/document-compatibility";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { hash } = await params;
  let normalized: string;
  try {
    normalized = normalizeSha256(hash);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_hash" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const blob = await db
    .selectFrom("blob")
    .innerJoin("member", "member.organizationId", "blob.organizationId")
    .select(["blob.contentType", "blob.byteSize", "blob.data", "blob.storagePath"])
    .where("blob.hash", "=", normalized)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();

  if (!blob) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let bytes: Buffer;
  try { bytes = await storedImageBytes(blob); }
  catch (error) {
    if (error instanceof DocumentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    console.error("Unable to read report image", error);
    return Response.json({ error: { code: "storage_unavailable", message: "Unable to read image storage." } }, { status: 503 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": String(blob.byteSize),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
