import { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable("profileLinks")
    .addColumn("userId", "text", (column) => column.primaryKey().references("user.id").onDelete("cascade"))
    .addColumn("x", "varchar(500)")
    .addColumn("linkedin", "varchar(500)")
    .addColumn("github", "varchar(500)")
    .addColumn("huggingface", "varchar(500)")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("profileLinks").execute();
}
