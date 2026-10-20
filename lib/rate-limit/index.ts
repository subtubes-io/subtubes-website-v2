import { postgresRateLimiter } from "./postgres";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

const offLimiter: RateLimiter = {
  async hit(_key, rule) {
    return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0 };
  },
};

// The backend is chosen by RATE_LIMIT_BACKEND: `postgres` (default) or `off` for local tooling. An Upstash backend is one more file here.
export function getRateLimiter(): RateLimiter {
  return process.env.RATE_LIMIT_BACKEND === "off" ? offLimiter : postgresRateLimiter;
}

export function clientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.retryAfterSeconds),
  };
}
