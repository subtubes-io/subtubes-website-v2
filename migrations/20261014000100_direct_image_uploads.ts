import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("blob")
    .alterColumn("data", (column) => column.dropNotNull())
    .addColumn("storagePath", "text")
    .addColumn("width", "integer")
    .addColumn("height", "integer")
    .execute();
  await sql`ALTER TABLE blob ADD CONSTRAINT blob_storage_check CHECK
    ((data IS NOT NULL AND "storagePath" IS NULL) OR (data IS NULL AND "storagePath" IS NOT NULL))`.execute(db);
  await db.schema.createTable("blobUpload")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("organizationId", "text", (column) => column.notNull().references("organization.id").onDelete("cascade"))
    .addColumn("ownerId", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
    .addColumn("hash", "text", (column) => column.notNull())
    .addColumn("contentType", "text", (column) => column.notNull())
    .addColumn("byteSize", "integer", (column) => column.notNull().check(sql`"byteSize" BETWEEN 1 AND 2097152`))
    .addColumn("resourceKind", "text", (column) => column.notNull().check(sql`"resourceKind" IN ('report', 'design')`))
    .addColumn("resourceId", "text", (column) => column.notNull())
    .addColumn("storagePath", "text", (column) => column.notNull().unique())
    .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
    .addColumn("completedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("blob_upload_expiry").on("blobUpload").column("expiresAt").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const external = await sql<{ count: string }>`SELECT count(*) FROM blob WHERE "storagePath" IS NOT NULL`.execute(db);
  if (Number(external.rows[0].count)) throw new Error("Restore external image bytes into blob.data before rolling back direct image storage.");
  await db.schema.dropTable("blobUpload").execute();
  await sql`ALTER TABLE blob DROP CONSTRAINT blob_storage_check`.execute(db);
  await db.schema.alterTable("blob").dropColumn("storagePath").dropColumn("width").dropColumn("height")
    .alterColumn("data", (column) => column.setNotNull()).execute();
}
