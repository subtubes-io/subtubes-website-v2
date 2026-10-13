import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("blob")
    .addColumn("organizationId", "text", (col) => col.notNull())
    .addColumn("hash", "text", (col) => col.notNull())
    .addColumn("contentType", "text", (col) => col.notNull())
    .addColumn("byteSize", "integer", (col) => col.notNull())
    .addColumn("data", "bytea", (col) => col.notNull())
    .addColumn("createdAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addPrimaryKeyConstraint("blob_pk", ["organizationId", "hash"])
    .addForeignKeyConstraint(
      "blob_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("design")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("organizationId", "text", (col) => col.notNull())
    .addColumn("ownerId", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("schemaVersion", "integer", (col) => col.notNull())
    .addColumn("revision", "integer", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("refs", "text", (col) => col.notNull())
    .addColumn("createdAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addForeignKeyConstraint(
      "design_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "design_owner_id_fk",
      ["ownerId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("report")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("organizationId", "text", (col) => col.notNull())
    .addColumn("ownerId", "text", (col) => col.notNull())
    .addColumn("projectName", "text", (col) => col.notNull())
    .addColumn("schemaVersion", "integer", (col) => col.notNull())
    .addColumn("revision", "integer", (col) => col.notNull())
    .addColumn("contentHash", "text", (col) => col.notNull())
    .addColumn("report", "text", (col) => col.notNull())
    .addColumn("refs", "text", (col) => col.notNull())
    .addColumn("createdAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addForeignKeyConstraint(
      "report_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "report_owner_id_fk",
      ["ownerId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("reportSnapshot")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("reportId", "text", (col) => col.notNull())
    .addColumn("organizationId", "text", (col) => col.notNull())
    .addColumn("ownerId", "text", (col) => col.notNull())
    .addColumn("number", "integer", (col) => col.notNull())
    .addColumn("takenAt", "timestamp", (col) => col.notNull())
    .addColumn("note", "text")
    .addColumn("commit", "text")
    .addColumn("schemaVersion", "integer", (col) => col.notNull())
    .addColumn("contentHash", "text", (col) => col.notNull())
    .addColumn("report", "text", (col) => col.notNull())
    .addColumn("refs", "text", (col) => col.notNull())
    .addColumn("createdAt", "timestamp", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addUniqueConstraint("report_snapshot_report_id_number_unique", [
      "reportId",
      "number",
    ])
    .addForeignKeyConstraint(
      "report_snapshot_report_id_fk",
      ["reportId"],
      "report",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "report_snapshot_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "report_snapshot_owner_id_fk",
      ["ownerId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("reportSnapshot").execute();
  await db.schema.dropTable("report").execute();
  await db.schema.dropTable("design").execute();
  await db.schema.dropTable("blob").execute();
}
