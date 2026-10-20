import { sql } from "kysely";
import { db } from "@/lib/db/client";
import type { RateLimiter } from "./index";

// Fixed-window counters: one atomic upsert per hit. Old windows are swept on about 1% of hits. If the database fails the request is let
// through (fail open): the database being down fails authentication anyway.
export const postgresRateLimiter: RateLimiter = {
  async hit(key, rule) {
    const windowMs = rule.windowSeconds * 1000;
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000));
    try {
      const row = await db
        .insertInto("rateLimitCounter")
        .values({ key, windowStart, count: 1 })
        .onConflict((oc) => oc.columns(["key", "windowStart"]).doUpdateSet({ count: sql`"rateLimitCounter".count + 1` }))
        .returning("count")
        .executeTakeFirstOrThrow();
      if (Math.random() < 0.01) {
        void db.deleteFrom("rateLimitCounter").where("windowStart", "<", new Date(now - 2 * 86_400_000)).execute().catch(() => {});
      }
      return {
        allowed: row.count <= rule.limit,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - row.count),
        retryAfterSeconds,
      };
    } catch (error) {
      console.error("Rate limiter unavailable", error instanceof Error ? error.message : "Unknown error");
      return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0 };
    }
  },
};
