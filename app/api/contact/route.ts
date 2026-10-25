import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { deliverContactMessage, parseContactMessage } from "@/lib/contact";
import { db } from "@/lib/db/client";
import { clientIp, getRateLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

export async function POST(request: Request) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Send your message from this website." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send your message as JSON." }, { status: 400 });
  }

  const limit = await getRateLimiter().hit(`ip:${clientIp(request)}:contact`, RATE_LIMITS.contactMessages());
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many messages. Please try again later." },
      { status: 429, headers: { ...rateLimitHeaders(limit), "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = await request.text();
  if (body.length > 12_000) return Response.json({ error: "That message is too large." }, { status: 413 });
  let message;
  try {
    message = parseContactMessage(JSON.parse(body));
  } catch (error) {
    const text = error instanceof SyntaxError ? "Send your message as JSON." : error instanceof Error ? error.message : "Invalid message.";
    return Response.json({ error: text }, { status: 400 });
  }

  try {
    await db.insertInto("contactMessage").values(message).execute();
    // The message is safe in the database; a failed delivery must not make the visitor send it again.
    await deliverContactMessage(message).catch((error) => console.error("Unable to deliver contact message", error));
    return Response.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to save contact message", error);
    return Response.json({ error: "Could not send your message. Please try again." }, { status: 500 });
  }
}
