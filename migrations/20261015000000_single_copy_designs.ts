import { Kysely, sql } from "kysely";

// A design is one current copy that a push replaces. Its content moves back onto the design row,
// taken from the version people were using (the preferred one, else the newest). The old version
// rows are left in place and are simply no longer read or written.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("design")
    .addColumn("name", "text")
    .addColumn("kind", "text")
    .addColumn("schemaVersion", "integer")
    .addColumn("revision", "integer")
    .addColumn("content", "text")
    .addColumn("refs", "text")
    .addColumn("contentHash", "text")
    .addColumn("deviceLabel", "text")
    .execute();
  await sql`
    UPDATE "design" AS d SET
      "name" = v."name", "kind" = v."kind", "schemaVersion" = v."schemaVersion", "revision" = v."revision",
      "content" = v."content", "refs" = v."refs", "contentHash" = v."contentHash", "deviceLabel" = v."deviceLabel"
    FROM "designVersion" AS v
    WHERE v."designId" = d."id" AND v."organizationId" = d."organizationId"
      AND v."id" = COALESCE(d."preferredVersionId", (
        SELECT x."id" FROM "designVersion" AS x
        WHERE x."designId" = d."id" AND x."organizationId" = d."organizationId"
        ORDER BY x."number" DESC LIMIT 1))
  `.execute(db);
  // A design row without any version holds no content, so there is nothing to keep.
  await sql`DELETE FROM "design" WHERE "content" IS NULL`.execute(db);
  await db.schema.alterTable("design")
    .alterColumn("name", (column) => column.setNotNull())
    .alterColumn("kind", (column) => column.setNotNull())
    .alterColumn("schemaVersion", (column) => column.setNotNull())
    .alterColumn("revision", (column) => column.setNotNull())
    .alterColumn("content", (column) => column.setNotNull())
    .alterColumn("refs", (column) => column.setNotNull())
    .alterColumn("contentHash", (column) => column.setNotNull())
    .execute();
}

export async function down(): Promise<void> {
  throw new Error("The single-copy design columns cannot be discarded by rollback. Restore a verified backup or write a forward migration.");
}
