import { Kysely, sql } from "kysely";

// Pull-request reports are gone from the website. The table and its data are dropped; down() recreates only an empty table shell is not
// attempted, so this migration is one-way.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "pullRequestReport"`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Dropped pull-request reports cannot be restored.");
}
