import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const globalForDb = globalThis as typeof globalThis & {
  subtubesPool?: Pool;
  subtubesDb?: Kysely<Database>;
};

export const pool = globalForDb.subtubesPool ?? new Pool({ connectionString });
export const db =
  globalForDb.subtubesDb ??
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.subtubesPool = pool;
  globalForDb.subtubesDb = db;
}
