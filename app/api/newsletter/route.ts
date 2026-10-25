import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { isTrustedAuthOrigin } from "@/lib/auth-origins";
import { db } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/resend";
import { confirmationEmail, parseNewsletterEmail } from "@/lib/newsletter";
import { clientIp, getRateLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit/policy";

export async function POST(request: Request) {
  if (!isTrustedAuthOrigin(request.headers.get("origin"))) {
    return Response.json({ error: "Subscribe from this website." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Send your email as JSON." }, { status: 400 });
  }

  const limit = await getRateLimiter().hit(`ip:${clientIp(request)}:newsletter`, RATE_LIMITS.newsletterSignup());
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { ...rateLimitHeaders(limit), "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let email: string;
  try {
    const body = await request.text();
    if (body.length > 1024) return Response.json({ error: "That request is too large." }, { status: 413 });
    email = parseNewsletterEmail((JSON.parse(body) as { email?: unknown } | null)?.email);
  } catch (error) {
    const message = error instanceof SyntaxError ? "Send your email as JSON." : error instanceof Error ? error.message : "Invalid email.";
    return Response.json({ error: message }, { status: 400 });
  }

  // A new address is stored and mailed a confirmation link. A repeat is quiet, so the form cannot reveal who is subscribed: a
  // confirmed address is left alone, and one still waiting is re-mailed at most every 15 minutes.
  const token = randomBytes(32).toString("hex");
  let sent: { token: string } | undefined;
  try {
    sent = await db.insertInto("newsletterSubscriber").values({ email, token })
      .onConflict((conflict) => conflict.column("email")
        .doUpdateSet({ confirmationSentAt: sql<Date>`now()` })
        .where("newsletterSubscriber.confirmedAt", "is", null)
        .where("newsletterSubscriber.confirmationSentAt", "<", sql<Date>`now() - interval '15 minutes'`))
      .returning("token").executeTakeFirst();
  } catch (error) {
    console.error("Unable to save newsletter signup", error);
    return Response.json({ error: "Could not sign you up. Please try again." }, { status: 500 });
  }

  if (sent) {
    try {
      await sendEmail(confirmationEmail(email, sent.token, process.env.BETTER_AUTH_URL || new URL(request.url).origin));
    } catch (error) {
      console.error("Unable to send newsletter confirmation", error);
      // Let the visitor try again straight away instead of waiting out the 15 minutes.
      await db.updateTable("newsletterSubscriber").set({ confirmationSentAt: sql<Date>`now() - interval '1 day'` })
        .where("token", "=", sent.token).execute().catch(() => {});
      return Response.json({ error: "Could not send the confirmation email. Please try again." }, { status: 502 });
    }
  }
  return Response.json({ subscribed: true }, { headers: { "Cache-Control": "no-store" } });
}
