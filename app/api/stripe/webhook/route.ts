import type Stripe from "stripe";
import { handleStripeEvent } from "@/lib/billing/billing";
import { stripe } from "@/lib/billing/stripe";

const NO_STORE = { "Cache-Control": "no-store" };

// Stripe calls this for payments and subscription changes. The signature is checked against the raw body before anything is read.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!signature) return Response.json({ error: "bad-signature" }, { status: 400, headers: NO_STORE });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return Response.json({ error: "bad-signature" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await handleStripeEvent(event);
    return Response.json({ received: true, result }, { headers: NO_STORE });
  } catch (error) {
    // A 500 makes Stripe deliver the event again; nothing of it was stored.
    console.error("Stripe webhook failed", event.type, error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}
