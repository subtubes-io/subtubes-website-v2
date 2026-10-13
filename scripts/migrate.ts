import { loadEnvConfig } from "@next/env";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from "kysely";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString }),
  }),
});

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(process.cwd(), "migrations"),
  }),
});

async function main(): Promise<void> {
  try {
    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === "Success") {
        console.log(`Migration "${result.migrationName}" succeeded.`);
      } else if (result.status === "Error") {
        console.error(`Migration "${result.migrationName}" failed.`);
      }
    }

    if (error) {
      throw error;
    }

    if (!results?.length) {
      console.log("No pending migrations.");
    }
  } catch (error) {
    console.error("Database migration failed.", error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
