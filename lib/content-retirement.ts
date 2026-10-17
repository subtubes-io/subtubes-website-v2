import { sql, type Kysely } from "kysely";

export const RETIRED_IMAGE_PREFIX = "report-images/";
export const RETIRED_TABLES = ["reportSnapshot", "report", "designVersion", "design", "blobUpload"] as const;
const WRITE_TABLES = [...RETIRED_TABLES, "blob"];
const MAX_UPLOAD_TOKEN_AGE_MS = 15 * 60_000;

export interface RetirementStorage {
  list(): Promise<string[]>;
  delete(path: string): Promise<void>;
}

export function isRetiredImagePath(path: string): boolean {
  return path.startsWith(RETIRED_IMAGE_PREFIX) && !path.includes("\\") &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export async function retirementInventory(db: Kysely<unknown>, storage: RetirementStorage) {
  const tables: Record<string, number> = {};
  for (const table of RETIRED_TABLES) {
    const result = await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${sql.table(table)}`.execute(db);
    tables[table] = result.rows[0].count;
  }
  const blobs = await sql<{ storagePath: string | null }>`SELECT "storagePath" FROM blob`.execute(db);
  const uploads = await sql<{ storagePath: string }>`SELECT "storagePath" FROM "blobUpload"`.execute(db);
  if (uploads.rows.some((row) => !isRetiredImagePath(row.storagePath))) {
    throw new Error("An upload intent has an unrecognized path; review it before retirement.");
  }
  const listed = await storage.list();
  if (listed.some((path) => !isRetiredImagePath(path))) {
    throw new Error("Storage inventory returned a path outside the retired image prefix.");
  }
  const paths = [...new Set([
    ...listed,
    ...blobs.rows.flatMap(({ storagePath }) => storagePath && isRetiredImagePath(storagePath) ? [storagePath] : []),
    ...uploads.rows.map(({ storagePath }) => storagePath),
  ])].sort();
  return {
    tables,
    paths,
    inlineImages: blobs.rows.filter(({ storagePath }) => storagePath === null).length,
    preservedExternalBlobs: blobs.rows.filter(({ storagePath }) => storagePath && !isRetiredImagePath(storagePath)).length,
  };
}

export async function freezeRetiredContent(db: Kysely<unknown>): Promise<Date> {
  return db.transaction().execute(async (tx) => {
    await sql`CREATE TABLE IF NOT EXISTS content_retirement (
      id boolean PRIMARY KEY DEFAULT true CHECK (id),
      "frozenAt" timestamptz NOT NULL DEFAULT now(),
      "cleanedAt" timestamptz
    )`.execute(tx);
    await sql`CREATE OR REPLACE FUNCTION reject_retired_content_writes() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Report and design writes are permanently disabled for retirement';
      END
      $$`.execute(tx);
    for (const table of WRITE_TABLES) {
      await sql`DROP TRIGGER IF EXISTS content_retirement_freeze ON ${sql.table(table)}`.execute(tx);
      await sql`CREATE TRIGGER content_retirement_freeze BEFORE INSERT OR UPDATE ON ${sql.table(table)}
        FOR EACH STATEMENT EXECUTE FUNCTION reject_retired_content_writes()`.execute(tx);
    }
    await sql`INSERT INTO content_retirement (id, "frozenAt") VALUES (true, clock_timestamp()) ON CONFLICT DO NOTHING`.execute(tx);
    const result = await sql<{ frozenAt: Date }>`SELECT "frozenAt" FROM content_retirement WHERE id`.execute(tx);
    return new Date(result.rows[0].frozenAt.getTime() + MAX_UPLOAD_TOKEN_AGE_MS);
  });
}

export async function cleanupRetiredContent(
  db: Kysely<unknown>,
  storage: RetirementStorage,
  recordInventory: (inventory: Awaited<ReturnType<typeof retirementInventory>>) => Promise<void>,
) {
  const state = await sql<{ frozenAt: Date }>`SELECT "frozenAt" FROM content_retirement WHERE id`.execute(db);
  if (!state.rows.length) throw new Error("Freeze retired writes before cleanup.");
  const safeAfter = new Date(state.rows[0].frozenAt.getTime() + MAX_UPLOAD_TOKEN_AGE_MS);
  if (Date.now() < safeAfter.getTime()) {
    throw new Error(`Outstanding direct-upload credentials may still be valid. Retry after ${safeAfter.toISOString()}.`);
  }
  await sql`UPDATE content_retirement SET "cleanedAt" = NULL WHERE id`.execute(db);
  const inventory = await retirementInventory(db, storage);
  await recordInventory(inventory);
  for (const path of inventory.paths) await storage.delete(path);
  const remaining = await storage.list();
  if (remaining.length) throw new Error("Retired image files remain in storage; cleanup must be retried.");
  await db.transaction().execute(async (tx) => {
    await sql`DELETE FROM blob WHERE "storagePath" IS NULL OR "storagePath" LIKE ${`${RETIRED_IMAGE_PREFIX}%`}`.execute(tx);
    await sql`DELETE FROM "blobUpload"`.execute(tx);
    await sql`UPDATE content_retirement SET "cleanedAt" = now() WHERE id`.execute(tx);
  });
  return inventory;
}
