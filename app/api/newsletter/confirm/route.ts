import { NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db/client";

// Confirming is idempotent, so a mail scanner opening the link early does no harm.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const target = (status: string) => NextResponse.redirect(new URL(`/newsletter?status=${status}`, request.url), 303);
  if (!/^[0-9a-f]{64}$/.test(token)) return target("invalid");
  try {
    const row = await db.updateTable("newsletterSubscriber")
      .set({ confirmedAt: sql<Date>`coalesce("confirmedAt", now())` })
      .where("token", "=", token).returning("email").executeTakeFirst();
    return target(row ? "confirmed" : "invalid");
  } catch (error) {
    console.error("Unable to confirm newsletter signup", error);
    return target("error");
  }
}
