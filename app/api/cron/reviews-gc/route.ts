import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { failure, response } from "@/lib/reviews/http";
import { collectReviews } from "@/lib/reviews/gc";
import { createReviewStorage } from "@/lib/reviews/storage";

export const maxDuration = 300;
export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("Review cleanup is not configured: CRON_SECRET is missing.");
    return response({ error: "unavailable", message: "Cleanup is not configured." }, 503);
  }
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return response({ error: "unauthorized", message: "Authentication required." }, 401);
  }
  try { return response(await collectReviews(db, createReviewStorage())); }
  catch (error) { return failure(error); }
}
