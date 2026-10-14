import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import sharp from "sharp";
import { up as initial } from "../migrations/20261012000000_initial_schema";
import { up as profileLinks } from "../migrations/20261012000100_profile_links";
import { up as reports } from "../migrations/20261012000200_cloud_reports";
import { up as versions } from "../migrations/20261013000000_design_versions";
import { up as directImages, down as rollbackImages } from "../migrations/20261014000100_direct_image_uploads";
import { DocumentError } from "../lib/cloud-push/document-compatibility";
import type { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

loadEnvConfig(process.cwd());

test("direct image intents, verification, authorization, retries and migration preservation in isolated PostgreSQL", async () => {
  const connection = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname), "Only local PostgreSQL is allowed");
  const schema = `images_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: connection.toString() });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = connection.toString();
  const database = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.toString() }) }) });
  let closeApp: (() => Promise<void>) | undefined;
  try {
    await initial(database);
    await profileLinks(database);
    await reports(database);
    await versions(database);
    const owner = randomUUID(), other = randomUUID(), org = randomUUID(), otherOrg = randomUUID();
    for (const id of [owner, other]) await sql`INSERT INTO "user" (id,name,email) VALUES (${id},'Image tester',${id + "@example.test"})`.execute(database);
    for (const id of [org, otherOrg]) await sql`INSERT INTO organization (id,name,slug,"createdAt") VALUES (${id},'Image org',${id},now())`.execute(database);
    const legacy = Buffer.from("immutable historical bytes");
    await sql`INSERT INTO blob ("organizationId",hash,"contentType","byteSize",data)
      VALUES (${org},${"b".repeat(64)},'image/png',${legacy.length},${legacy})`.execute(database);
    await directImages(database);
    const existing = await sql<{ data: Buffer; storagePath: string | null }>`SELECT data,"storagePath" FROM blob`.execute(database);
    assert.deepEqual(existing.rows[0], { data: legacy, storagePath: null });
    const { db } = await import("../lib/db/client");
    closeApp = () => db.destroy();
    const { issueImageUpload, completeImageUpload } = await import("../lib/cloud-push/blob-uploads");
    const bytes = await sharp({ create: { width: 50, height: 30, channels: 3, background: "blue" } }).png().toBuffer();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const input = { hash, contentType: "image/png", byteSize: bytes.length, resource: { kind: "report", id: randomUUID() } };
    let stored = bytes;
    let reads = 0;
    let constraints: Parameters<typeof generateClientTokenFromReadWriteToken>[0] | undefined;
    const provider = {
      authorize: async (options: Parameters<typeof generateClientTokenFromReadWriteToken>[0]) => { constraints = options; return "restricted-test-token"; },
      read: async () => { reads++; return stored; },
    };
    const intent = await issueImageUpload(org, owner, input, provider);
    assert.equal(intent.state, "upload");
    if (intent.state !== "upload") throw new Error("Expected an upload intent");
    assert.equal(constraints?.maximumSizeInBytes, bytes.length);
    assert.equal(constraints?.allowOverwrite, false);
    assert.equal(constraints?.pathname, `report-images/${org}/${intent.uploadId}/${hash}`);
    assert.deepEqual(constraints?.allowedContentTypes, ["image/png"]);
    assert.equal(await db.selectFrom("blob").select("hash").where("hash", "=", hash).executeTakeFirst(), undefined, "Unverified intent is not a blob");
    const errorCode = (code: string) => (error: unknown) => error instanceof DocumentError && error.code === code;
    await assert.rejects(completeImageUpload(otherOrg, owner, intent.uploadId, provider), errorCode("not_found"));
    await assert.rejects(completeImageUpload(org, other, intent.uploadId, provider), errorCode("not_found"));
    stored = Buffer.from("wrong bytes");
    await assert.rejects(completeImageUpload(org, owner, intent.uploadId, provider), errorCode("hash_mismatch"));
    assert.equal(await db.selectFrom("blob").select("hash").where("hash", "=", hash).executeTakeFirst(), undefined);
    stored = bytes;
    await Promise.all([completeImageUpload(org, owner, intent.uploadId, provider), completeImageUpload(org, owner, intent.uploadId, provider)]);
    const saved = await db.selectFrom("blob").selectAll().where("hash", "=", hash).executeTakeFirstOrThrow();
    assert.equal(saved.data, null);
    assert.equal(saved.storagePath, intent.pathname);
    assert.equal(saved.width, 50);
    assert.equal(saved.height, 30);
    const beforeReplay = reads;
    assert.deepEqual(await completeImageUpload(org, owner, intent.uploadId, provider), { state: "ready", hash });
    assert.equal(reads, beforeReplay);
    assert.deepEqual(await issueImageUpload(org, owner, input, provider), { state: "ready", hash });
    assert.equal((await issueImageUpload(otherOrg, owner, input, provider)).state, "upload", "Deduplication never leaks across organizations");
    await assert.rejects(issueImageUpload(org, owner, { ...input, byteSize: 2 * 1024 * 1024 + 1 }, provider), errorCode("invalid_document"));
    const expired = await issueImageUpload(org, owner, { ...input, hash: "c".repeat(64) }, provider);
    if (expired.state !== "upload") throw new Error("Expected expiring intent");
    await db.updateTable("blobUpload").set({ expiresAt: new Date(0) }).where("id", "=", expired.uploadId).execute();
    await assert.rejects(completeImageUpload(org, owner, expired.uploadId, provider), errorCode("upload_expired"));
    const destination = randomUUID();
    await db.insertInto("design").values({
      id: destination, organizationId: org, ownerId: other,
    }).execute();
    await assert.rejects(issueImageUpload(org, owner, { ...input, resource: { kind: "design", id: destination } }, provider), errorCode("forbidden"));

    const ownerToken = randomUUID(), otherToken = randomUUID();
    for (const [userId, token] of [[owner, ownerToken], [other, otherToken]]) {
      const now = new Date();
      await db.insertInto("member").values({ id: randomUUID(), organizationId: org, userId, role: "member", createdAt: now }).execute();
      await db.insertInto("session").values({
        id: randomUUID(), userId, token, expiresAt: new Date(Date.now() + 3600000),
        createdAt: now, updatedAt: now, ipAddress: null, userAgent: null, activeOrganizationId: null,
      }).execute();
    }
    const authorize = await import("../app/api/v1/organizations/[orgId]/blobs/uploads/route");
    const complete = await import("../app/api/v1/organizations/[orgId]/blobs/uploads/[uploadId]/complete/route");
    const request = (token = "", body: unknown = input) => new Request("http://localhost/api/upload", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const context = { params: Promise.resolve({ orgId: org, uploadId: intent.uploadId }) };
    const status = (response: Response | undefined) => { assert.ok(response); return response.status; };
    assert.equal(status(await authorize.POST(request(), context)), 401);
    assert.equal(status(await complete.POST(request(), context)), 401);
    const foreignContext = { params: Promise.resolve({ orgId: otherOrg, uploadId: intent.uploadId }) };
    assert.equal(status(await authorize.POST(request(ownerToken), foreignContext)), 403);
    assert.equal(status(await complete.POST(request(ownerToken), foreignContext)), 403);
    assert.equal(status(await complete.POST(request(otherToken), context)), 404);
    assert.equal(status(await complete.POST(request(ownerToken), context)), 200);
    assert.equal(status(await authorize.POST(request(ownerToken), context)), 200);
    assert.equal(status(await authorize.POST(request(ownerToken, { ...input, byteSize: 0 }), context)), 422);
    assert.equal(status(await authorize.POST(request(ownerToken, "x".repeat(4096)), context)), 413);
    await db.deleteFrom("member").where("userId", "=", owner).execute();
    assert.equal(status(await complete.POST(request(ownerToken), context)), 403, "Revoked membership prevents completion even for the intent's owner");
    await assert.rejects(rollbackImages(database), /Restore external image bytes/);
    await db.deleteFrom("blob").where("hash", "=", hash).execute();
    await rollbackImages(database);
    const restored = await sql<{ data: Buffer }>`SELECT data FROM blob`.execute(database);
    assert.deepEqual(restored.rows[0].data, legacy);
  } finally {
    await closeApp?.();
    await database.destroy();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
