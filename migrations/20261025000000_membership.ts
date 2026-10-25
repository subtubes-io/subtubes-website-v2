import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable("membership")
    .addColumn("userId", "text", (column) => column.primaryKey().references("user.id").onDelete("cascade"))
    .addColumn("stripeCustomerId", "text", (column) => column.notNull().unique())
    .addColumn("stripeSubscriptionId", "text", (column) => column.unique())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("none"))
    .addColumn("currentPeriodEnd", "timestamptz")
    .addColumn("cancelAtPeriodEnd", "boolean", (column) => column.notNull().defaultTo(false))
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("membership").execute();
}
