import { db } from "@/lib/db/client";
import { getSession } from "@/lib/session";
import { normalizeSha256 } from "@/lib/cloud-push/common";

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
    .select(["blob.contentType", "blob.byteSize", "blob.data"])
    .where("blob.hash", "=", normalized)
    .where("member.userId", "=", session.user.id)
    .executeTakeFirst();

  if (!blob) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(new Uint8Array(blob.data), {
    status: 200,
    headers: {
      "Content-Type": blob.contentType,
      "Content-Length": String(blob.byteSize),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
