import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  cleanupRetiredContent, freezeRetiredContent, isRetiredImagePath,
  retirementInventory, RETIRED_TABLES, type RetirementStorage,
} from "../lib/content-retirement";
import { up as retire, down as rollbackRetirement } from "../migrations/20261017000000_retire_reports_and_designs";

test("only the retired storage namespace is eligible for deletion", () => {
  assert.equal(isRetiredImagePath("report-images/org/upload/hash"), true);
  for (const value of [
    "avatars/user/photo.webp", "other-files/photo", "report-images", "report-images/",
    "x/report-images/file", "report-images/../avatars/photo", "report-images/\\avatars/photo",
  ]) {
    assert.equal(isRetiredImagePath(value), false);
  }
});

test("retirement cannot pretend to restore permanently deleted content", async () => {
  await assert.rejects(rollbackRetirement(), /permanent/);
});

const connectionString = process.env.RETIREMENT_TEST_DATABASE_URL;
test("fresh and populated migrations preserve the foundation and cleanup fails safely", {
  skip: !connectionString && "Set RETIREMENT_TEST_DATABASE_URL to a disposable localhost PostgreSQL database.",
}, async () => {
  assert.ok(connectionString);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(connectionString).hostname),
    "Retirement integration tests must not run on a hosted database.");
  const admin = new Pool({ connectionString });
  const schema = `retirement_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, options: `-c search_path=${schema}`, max: 1 }),
    }),
  });
  const migrator = new Migrator({
    db,
    migrationTableSchema: schema,
    provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(process.cwd(), "migrations") }),
  });
  const paths = new Set(["report-images/org/known/hash", "report-images/org/orphan/hash", "report-images/org/pending/hash"]);
  const deleted: string[] = [];
  let failDelete = false;
  let failList = false;
  const storage: RetirementStorage = {
    async list() {
      if (failList) throw new Error("Storage listing failed.");
      return [...paths];
    },
    async delete(value) {
      if (failDelete) throw new Error("Storage deletion failed.");
      deleted.push(value);
      paths.delete(value);
    },
  };
  try {
    const initial = await migrator.migrateTo("20261015000000_single_copy_designs");
    if (initial.error) throw initial.error;
    await sql`INSERT INTO "user" (id, name, email, image) VALUES ('user', 'Example', 'fixture@example.test', 'https://example.test/avatar.webp')`.execute(db);
    await sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES ('org', 'Example', 'example', now())`.execute(db);
    await sql`INSERT INTO member (id, "organizationId", "userId", "createdAt") VALUES ('member', 'org', 'user', now())`.execute(db);
    await sql`INSERT INTO session (id, token, "userId", "expiresAt", "updatedAt") VALUES ('session', 'fixture-session', 'user', now() + interval '1 day', now())`.execute(db);
    await sql`INSERT INTO report (id, "organizationId", "ownerId", "projectName", "schemaVersion", revision, "contentHash", report, refs)
      VALUES ('report', 'org', 'user', 'Example', 1, 1, 'hash', '{}', '{}')`.execute(db);
    await sql`INSERT INTO design (id, "organizationId", "ownerId", name, kind, "schemaVersion", revision, content, refs, "contentHash")
      VALUES ('design', 'org', 'user', 'Example', 'diagram', 1, 1, '{}', '{}', 'hash')`.execute(db);
    await sql`INSERT INTO blob ("organizationId", hash, "contentType", "byteSize", data, "storagePath") VALUES
      ('org', 'known', 'image/png', 1, NULL, 'report-images/org/known/hash'),
      ('org', 'inline', 'image/png', 1, ${Buffer.from([1])}, NULL),
      ('org', 'unrelated', 'image/png', 1, NULL, 'future-files/unrelated')`.execute(db);
    await sql`INSERT INTO "blobUpload" (id, "organizationId", "ownerId", hash, "contentType", "byteSize",
      "resourceKind", "resourceId", "storagePath", "expiresAt") VALUES
      ('upload', 'org', 'user', 'pending', 'image/png', 1, 'report', 'report', 'report-images/org/pending/hash', now())`.execute(db);

    await assert.rejects(retire(db), /guarded content:retire/);
    const inventory = await retirementInventory(db, storage);
    assert.equal(inventory.paths.length, 3);
    assert.equal(inventory.inlineImages, 1);
    assert.equal(inventory.preservedExternalBlobs, 1);
    assert.equal(deleted.length, 0, "Inventory must not mutate storage.");
    await assert.rejects(retirementInventory(db, {
      ...storage, list: async () => ["avatars/user/photo.webp"],
    }), /outside the retired image prefix/);
    failList = true;
    await assert.rejects(retirementInventory(db, storage), /listing failed/);
    failList = false;
    const safeAfter = await freezeRetiredContent(db);
    assert.ok(safeAfter.getTime() > Date.now());
    assert.equal((await freezeRetiredContent(db)).getTime(), safeAfter.getTime(), "Retrying freeze must not extend expiry.");
    await assert.rejects(sql`UPDATE report SET revision = 2`.execute(db), /permanently disabled/);
    await assert.rejects(cleanupRetiredContent(db, storage, async () => {}), /credentials may still be valid/);
    // Expire only the synthetic local test's write-freeze interval.
    await sql`UPDATE content_retirement SET "frozenAt" = now() - interval '16 minutes'`.execute(db);
    await assert.rejects(cleanupRetiredContent(db, storage, async () => {
      throw new Error("Inventory could not be persisted.");
    }), /could not be persisted/);
    assert.equal(deleted.length, 0);
    failDelete = true;
    await assert.rejects(cleanupRetiredContent(db, storage, async () => {}), /deletion failed/);
    assert.equal((await sql<{ count: number }>`SELECT count(*)::int AS count FROM "blobUpload"`.execute(db)).rows[0].count, 1);
    await assert.rejects(retire(db), /guarded content:retire/);
    failDelete = false;
    let recorded = false;
    await cleanupRetiredContent(db, storage, async () => { recorded = true; });
    assert.equal(recorded, true);
    assert.equal(paths.size, 0);
    await cleanupRetiredContent(db, storage, async () => {});
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
    for (const table of RETIRED_TABLES) {
      const present = await sql<{ name: string | null }>`SELECT to_regclass(${`"${table}"`})::text AS name`.execute(db);
      assert.equal(present.rows[0].name, null, `${table} must be removed`);
    }
    for (const table of ["user", "organization", "member", "session", "blob"]) {
      assert.equal((await sql<{ count: number }>`SELECT count(*)::int AS count FROM ${sql.table(table)}`.execute(db)).rows[0].count, 1);
    }
    assert.equal((await sql<{ image: string }>`SELECT image FROM "user"`.execute(db)).rows[0].image, "https://example.test/avatar.webp");
    await sql`UPDATE blob SET width = 1`.execute(db);
  } finally {
    await db.destroy();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }

  const freshSchema = `retirement_${randomUUID().replaceAll("-", "")}`;
  const freshAdmin = new Pool({ connectionString });
  await freshAdmin.query(`CREATE SCHEMA "${freshSchema}"`);
  const freshDb = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, options: `-c search_path=${freshSchema}`, max: 1 }) }),
  });
  try {
    const freshMigrator = new Migrator({
      db: freshDb, migrationTableSchema: freshSchema,
      provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(process.cwd(), "migrations") }),
    });
    const result = await freshMigrator.migrateToLatest();
    if (result.error) throw result.error;
    assert.equal((await sql<{ count: number }>`SELECT count(*)::int AS count FROM blob`.execute(freshDb)).rows[0].count, 0);
  } finally {
    await freshDb.destroy();
    await freshAdmin.query(`DROP SCHEMA "${freshSchema}" CASCADE`);
    await freshAdmin.end();
  }
});
