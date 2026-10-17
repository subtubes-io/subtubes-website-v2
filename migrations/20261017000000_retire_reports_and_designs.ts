import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  const stateTable = await sql<{ name: string | null }>`SELECT to_regclass('content_retirement')::text AS name`.execute(db);
  let cleaned = false;
  if (stateTable.rows[0].name) {
    const state = await sql<{ cleanedAt: Date | null }>`SELECT "cleanedAt" FROM content_retirement WHERE id`.execute(db);
    cleaned = Boolean(state.rows[0]?.cleanedAt);
    if (!cleaned) throw new Error("Run the guarded content:retire cleanup after frozen upload credentials expire.");
  }
  const content = await sql<{ count: number }>`SELECT (
    (SELECT count(*) FROM report) +
    (SELECT count(*) FROM "reportSnapshot") +
    (SELECT count(*) FROM design) +
    (SELECT count(*) FROM "designVersion") +
    (SELECT count(*) FROM "blobUpload") +
    (SELECT count(*) FROM blob WHERE "storagePath" IS NULL OR "storagePath" LIKE 'report-images/%')
  )::int AS count`.execute(db);
  if (content.rows[0].count && !cleaned) {
    throw new Error("Run the guarded content:retire freeze and cleanup commands before deleting report/design data.");
  }
  const external = await sql<{ count: number }>`SELECT (
    (SELECT count(*) FROM "blobUpload") +
    (SELECT count(*) FROM blob WHERE "storagePath" LIKE 'report-images/%')
  )::int AS count`.execute(db);
  if (external.rows[0].count) throw new Error("External image cleanup is incomplete; refusing to discard storage metadata.");

  await db.schema.alterTable("design").dropConstraint("design_preferred_version_fk").execute();
  for (const table of ["reportSnapshot", "report", "designVersion", "design", "blobUpload"]) {
    await db.schema.dropTable(table).execute();
  }
  await sql`DELETE FROM blob WHERE "storagePath" IS NULL`.execute(db);
  await sql`DROP TRIGGER IF EXISTS content_retirement_freeze ON blob`.execute(db);
  await sql`DROP FUNCTION IF EXISTS reject_retired_content_writes()`.execute(db);
  await sql`DROP TABLE IF EXISTS content_retirement`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Report/design deletion is permanent. Rollback cannot restore deleted content; use a verified backup.");
}
