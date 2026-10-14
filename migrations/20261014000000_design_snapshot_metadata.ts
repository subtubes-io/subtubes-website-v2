import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("designVersion").addColumn("snapshot", "text").execute();
}

export async function down(): Promise<void> {
  throw new Error("Design snapshot metadata cannot be discarded by rollback. Restore a verified backup or write a forward migration.");
}
