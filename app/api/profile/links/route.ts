import { auth } from "@/lib/auth";
import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { db } from "@/lib/db/client";
import { parseProfileLinks } from "@/lib/profile-links";

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to edit your profile links." }, { status: 401 });
  if (!isTrustedAuthOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Save profile links from this website." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send profile links as JSON." }, { status: 400 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Provide your profile links." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      return Response.json({ error: "Profile links are too large." }, { status: 413 });
    }
    chunks.push(value);
  }
  let links;
  try {
    links = parseProfileLinks(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid profile links.";
    console.warn("Profile links validation failed", message);
    return Response.json({ error: message }, { status: 400 });
  }
  try {
    await db.insertInto("profileLinks").values({ userId: session.user.id, ...links })
      .onConflict((conflict) => conflict.column("userId").doUpdateSet(links)).execute();
    return Response.json({ links }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to save profile links", error);
    return Response.json({ error: "Could not save your profile links. Please try again." }, { status: 500 });
  }
}
