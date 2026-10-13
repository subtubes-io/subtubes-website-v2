import type { PoolConfig } from "pg";

export function databaseConnectionConfig(
  connectionString: string,
  ca = process.env.DATABASE_SSL_CA,
): PoolConfig {
  if (!ca) return { connectionString };

  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("DATABASE_SSL_CA requires sslmode=verify-full");
  }
  for (const parameter of ["ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    if (url.searchParams.has(parameter)) {
      throw new Error(`DATABASE_SSL_CA cannot be combined with ${parameter}`);
    }
  }

  // pg's URL SSL settings otherwise replace the explicit certificate options.
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
  };
}
