import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Only same-site relative paths may be used as a post-login destination. */
export function safeNext(value: string | string[] | undefined, fallback = "/dashboard") {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : fallback;
}
