import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable("contactMessage")
    .addColumn("id", "uuid", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("name", "varchar(80)", (column) => column.notNull())
    .addColumn("email", "varchar(254)", (column) => column.notNull())
    .addColumn("message", "varchar(5000)", (column) => column.notNull())
    .addColumn("createdAt", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("contactMessage").execute();
}
