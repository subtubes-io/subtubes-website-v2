export function getAuthOrigins(
  baseURL = process.env.BETTER_AUTH_URL,
  additionalOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS,
): string[] {
  const origins = baseURL ? [new URL(baseURL).origin] : [];
  for (const value of additionalOrigins?.split(",") ?? []) {
    const origin = value.trim();
    if (!origin) continue;
    const url = new URL(origin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.hostname.includes("*")
    ) {
      throw new Error("BETTER_AUTH_TRUSTED_ORIGINS must contain exact HTTP(S) origins");
    }
    origins.push(origin);
  }
  return [...new Set(origins)];
}

export function isTrustedAuthOrigin(origin: string | null): boolean {
  return origin !== null && getAuthOrigins().includes(origin);
}
