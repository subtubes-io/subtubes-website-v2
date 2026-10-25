import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable("newsletterSubscriber")
    .addColumn("email", "varchar(254)", (column) => column.primaryKey())
    .addColumn("createdAt", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("newsletterSubscriber").execute();
}
