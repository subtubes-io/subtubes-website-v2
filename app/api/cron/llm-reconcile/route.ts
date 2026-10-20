import { timingSafeEqual } from "node:crypto";
import { reconcile } from "@/lib/llm/reconcile";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Vercel Cron (vercel.json) calls this with `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const result = await reconcile();
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
