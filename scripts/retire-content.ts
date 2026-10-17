import { loadEnvConfig } from "@next/env";
import { del, list } from "@vercel/blob";
import { writeFile } from "node:fs/promises";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { databaseConnectionConfig } from "../lib/db/connection";
import {
  cleanupRetiredContent,
  freezeRetiredContent,
  retirementInventory,
  RETIRED_IMAGE_PREFIX,
  type RetirementStorage,
} from "../lib/content-retirement";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? "--dry-run";
  if (!["--dry-run", "--freeze", "--execute"].includes(mode) || args.length > 2) {
    throw new Error("Usage: npm run content:retire -- [--dry-run|--freeze|--execute] [inventory.json]");
  }
  const connectionString = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL must be set.");
  if (mode !== "--dry-run" && process.env.CONFIRM_CONTENT_RETIREMENT !== "delete-reports-and-designs") {
    throw new Error("Set CONFIRM_CONTENT_RETIREMENT=delete-reports-and-designs to authorize destructive retirement.");
  }
  if (mode === "--execute" && !args[1]) throw new Error("An inventory output path is required for retry/audit evidence.");
  const token = process.env.REPORT_BLOB_READ_WRITE_TOKEN;
  const storage: RetirementStorage = {
    async list() {
      if (!token) throw new Error("REPORT_BLOB_READ_WRITE_TOKEN is required to inventory the private image store.");
      const paths: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await list({ token, prefix: RETIRED_IMAGE_PREFIX, cursor });
        paths.push(...result.blobs.map((blob) => blob.pathname));
        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);
      return paths;
    },
    async delete(path) {
      await del(path, { token });
    },
  };
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ ...databaseConnectionConfig(connectionString), max: 1 }) }),
  });
  try {
    const target = new URL(connectionString);
    console.log(`Target: ${target.hostname}:${target.port || "5432"}${target.pathname}`);
    if (mode === "--freeze") {
      const safeAfter = await freezeRetiredContent(db);
      console.log(`Writes frozen. Run cleanup after ${safeAfter.toISOString()} so issued upload credentials have expired.`);
      return;
    }
    const record = async (inventory: Awaited<ReturnType<typeof retirementInventory>>) => {
      if (args[1]) await writeFile(args[1], JSON.stringify(inventory, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ ...inventory, paths: inventory.paths.length }));
    };
    if (mode === "--execute") {
      await cleanupRetiredContent(db, storage, record);
      console.log("Feature image cleanup verified. The retirement migration may now run.");
    } else {
      await record(await retirementInventory(db, storage));
      console.log("Dry run only. No database records or files were changed.");
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error("Content retirement failed.", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
