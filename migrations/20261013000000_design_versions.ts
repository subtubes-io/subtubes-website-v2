import { randomUUID } from "node:crypto";
import { Kysely, sql } from "kysely";
import { computeCanonicalContentHash } from "../lib/cloud-push/hash";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("design")
    .addColumn("preferredVersionId", "text")
    .addColumn("headGeneration", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("versionCount", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable("design")
    .addUniqueConstraint("design_id_org_unique", ["id", "organizationId"]).execute();

  await db.schema.createTable("designVersion")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("designId", "text", (c) => c.notNull())
    .addColumn("organizationId", "text", (c) => c.notNull())
    .addColumn("number", "integer", (c) => c.notNull())
    .addColumn("uploadId", "text", (c) => c.notNull())
    .addColumn("requestHash", "text", (c) => c.notNull())
    .addColumn("contentHash", "text", (c) => c.notNull())
    .addColumn("authorId", "text", (c) => c.notNull())
    .addColumn("deviceLabel", "text")
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("schemaVersion", "integer", (c) => c.notNull())
    .addColumn("revision", "integer", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("refs", "text", (c) => c.notNull())
    .addColumn("createdAt", "timestamp", (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("design_version_number_unique", ["designId", "number"])
    .addUniqueConstraint("design_version_upload_unique", ["designId", "uploadId"])
    .addUniqueConstraint("design_version_scope_unique", ["designId", "organizationId", "id"])
    .addForeignKeyConstraint("design_version_design_fk",
      ["designId", "organizationId"], "design", ["id", "organizationId"],
      (c) => c.onDelete("cascade"))
    .addForeignKeyConstraint("design_version_author_fk",
      ["authorId"], "user", ["id"], (c) => c.onDelete("cascade"))
    .addCheckConstraint("design_version_number_positive", sql`"number" > 0`)
    .execute();

  const typed = db.withTables<{
    design: {
      id: string; organizationId: string; ownerId: string; name: string; kind: string;
      schemaVersion: number; revision: number; content: string; refs: string;
      createdAt: Date; preferredVersionId: string | null; headGeneration: number; versionCount: number;
    };
    designVersion: {
      id: string; designId: string; organizationId: string; number: number;
      uploadId: string; requestHash: string; contentHash: string; authorId: string;
      name: string; kind: string; schemaVersion: number; revision: number;
      content: string; refs: string; createdAt: Date;
    };
  }>();
  for (const design of await typed.selectFrom("design").selectAll().execute()) {
    const id = randomUUID();
    const hash = computeCanonicalContentHash({
      name: design.name, kind: design.kind, schemaVersion: design.schemaVersion,
      revision: design.revision, content: JSON.parse(design.content), refs: JSON.parse(design.refs),
    });
    await typed.insertInto("designVersion").values({
      id, designId: design.id, organizationId: design.organizationId,
      number: 1, uploadId: `backfill:${id}`, requestHash: hash, contentHash: hash,
      authorId: design.ownerId, name: design.name, kind: design.kind,
      schemaVersion: design.schemaVersion, revision: design.revision,
      content: design.content, refs: design.refs, createdAt: design.createdAt,
    }).execute();
    await typed.updateTable("design").set({
      preferredVersionId: id, headGeneration: 1, versionCount: 1,
    }).where("id", "=", design.id).execute();
  }

  await db.schema.alterTable("design")
    .addForeignKeyConstraint("design_preferred_version_fk",
      ["id", "organizationId", "preferredVersionId"], "designVersion",
      ["designId", "organizationId", "id"])
    .execute();
  await db.schema.alterTable("design")
    .addCheckConstraint("design_head_nonnegative", sql`"headGeneration" >= 0`).execute();
  await db.schema.alterTable("design")
    .addCheckConstraint("design_count_nonnegative", sql`"versionCount" >= 0`).execute();
  await db.schema.alterTable("design")
    .dropColumn("name").dropColumn("kind").dropColumn("schemaVersion")
    .dropColumn("revision").dropColumn("content").dropColumn("refs")
    .execute();
}

export async function down(): Promise<void> {
  throw new Error("Design version history cannot be discarded by rollback. Restore a verified backup or write a forward migration.");
}
