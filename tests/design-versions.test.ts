import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "../lib/db/types";
import { computeCanonicalContentHash, computeSha256 } from "../lib/cloud-push/hash";
import { up as initialSchema } from "../migrations/20261012000000_initial_schema";
import { up as profileLinks } from "../migrations/20261012000100_profile_links";
import { up as cloudReports } from "../migrations/20261012000200_cloud_reports";
import { up as removeSnapshotFk } from "../migrations/20261012000201_remove_snapshot_report_fk";
import { up as versionSchema, down as rollbackVersions } from "../migrations/20261013000000_design_versions";
import { up as snapshotSchema, down as rollbackSnapshotMetadata } from "../migrations/20261014000000_design_snapshot_metadata";

loadEnvConfig(process.cwd());

test("diagram versions: isolated PostgreSQL migration, API and two-computer concurrency", async (t) => {
  const connection = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname),
    "Design integration tests must only run against local PostgreSQL");
  const schema = `design_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: connection.toString() });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = connection.toString();
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection.toString(), max: 8 }) }),
  });
  const db = database.withTables<{ [K in keyof Database]: Database[K] }>();
  let appDb: Kysely<Database> | undefined;
  const owner = randomUUID();
  const otherUser = randomUUID();
  const org = randomUUID();
  const otherOrg = randomUUID();
  const token = randomUUID();
  const readerToken = randomUUID();
  const legacyDesign = randomUUID();
  const legacyUpload = {
    uploadId: randomUUID(), expectedHeadGeneration: 0,
    document: {
      name: "Existing design", kind: "system", schemaVersion: 1, revision: 7,
      content: { nodes: [] }, refs: { blobs: [] },
    },
  };
  const now = new Date();
  try {
    await database.transaction().execute(async (tx) => {
      await initialSchema(tx);
      await profileLinks(tx);
      await cloudReports(tx);
      await removeSnapshotFk(tx);
      for (const id of [owner, otherUser]) {
        await sql`insert into "user" ("id", "name", "email") values (${id}, ${id}, ${id + "@example.test"})`.execute(tx);
      }
      for (const id of [org, otherOrg]) {
        await sql`insert into "organization" ("id", "name", "slug", "createdAt") values (${id}, ${id}, ${id}, ${now})`.execute(tx);
      }
      await sql`insert into "design" ("id", "organizationId", "ownerId", "name", "kind",
        "schemaVersion", "revision", "content", "refs")
        values (${legacyDesign}, ${org}, ${owner}, 'Existing design', 'system', 1, 7,
        '{"nodes":[]}', '{"blobs":[]}')`.execute(tx);
      await versionSchema(tx);
      await sql`update "designVersion" set "uploadId" = ${legacyUpload.uploadId},
        "requestHash" = ${computeCanonicalContentHash(legacyUpload)}
        where "designId" = ${legacyDesign}`.execute(tx);
      const before = await sql<Record<string, unknown>>`select * from "designVersion"`.execute(tx);
      await snapshotSchema(tx);
      const after = await sql`select * from "designVersion"`.execute(tx);
      assert.deepEqual(after.rows, before.rows.map((row) => ({ ...row, snapshot: null })));
    });

    const {
      parseUpload, saveDesignVersion, electPreferredVersion, readDesignBody, versionMetadata, DesignError,
    } = await import("../lib/cloud-push/designs");
    appDb = (await import("../lib/db/client")).db;
    const payload = (expectedHeadGeneration = 0, name = "Computer A", uploadId = randomUUID()) => parseUpload({
      uploadId, expectedHeadGeneration, deviceLabel: name,
      document: {
        name, kind: "swimlane", schemaVersion: 1, revision: 1,
        content: { nodes: [], links: [], groups: [] }, refs: { blobs: [] },
      },
    });
    const errorCode = (code: string) => (error: unknown) =>
      error instanceof DesignError && error.code === code;

    await t.test("migration preserves original document and refuses destructive rollback", async () => {
      const design = await db.selectFrom("design").selectAll().where("id", "=", legacyDesign).executeTakeFirstOrThrow();
      const version = await db.selectFrom("designVersion").selectAll().where("id", "=", design.preferredVersionId!).executeTakeFirstOrThrow();
      assert.equal(design.headGeneration, 1);
      assert.equal(design.versionCount, 1);
      assert.equal(version.revision, 7);
      assert.equal(version.name, "Existing design");
      assert.deepEqual(JSON.parse(version.content), { nodes: [] });
      assert.deepEqual(JSON.parse(version.refs), { blobs: [] });
      assert.equal(version.snapshot, null);
      assert.equal(Object.hasOwn(versionMetadata(version), "snapshot"), false);
      const replay = await saveDesignVersion(db, org, legacyDesign, owner, parseUpload(legacyUpload));
      assert.equal(replay.replayed, true);
      assert.equal(replay.savedVersion.id, version.id);
      assert.equal(replay.versionCount, 1);
      assert.equal(replay.savedVersion.contentHash, computeCanonicalContentHash(legacyUpload.document));
      assert.equal(Object.hasOwn(replay.savedVersion, "snapshot"), false);
      await assert.rejects(rollbackVersions(), /cannot be discarded/);
      await assert.rejects(rollbackSnapshotMetadata(), /cannot be discarded/);
    });

    const capture = {
      snapshotId: "local_capture-1", note: "  Approved baseline  ", reason: "manual",
      takenAt: "2026-10-13T12:00:00Z", sourceRevision: 1,
    };
    const normalizedCapture = { ...capture, note: "Approved baseline", takenAt: "2026-10-13T12:00:00.000Z" };
    await t.test("snapshot metadata validates exact fields, bounds, UTC timestamps and source revision", () => {
      const valid = payload();
      for (const snapshot of [
        null, {}, { ...capture, snapshotId: "" }, { ...capture, snapshotId: "a".repeat(121) },
        { ...capture, snapshotId: "../capture" }, { ...capture, snapshotId: "non-ascii-\u00e9" },
        { ...capture, note: "a".repeat(2_001) }, { ...capture, note: null },
        { ...capture, reason: "automatic" }, { ...capture, reason: undefined },
        { ...capture, takenAt: "2026-02-30T12:00:00Z" },
        { ...capture, takenAt: "2026-10-13T12:00:00+00:00" },
        { ...capture, takenAt: "2026-10-13T12:00:00" }, { ...capture, takenAt: "not-a-date" },
        { ...capture, takenAt: undefined }, { ...capture, sourceRevision: 0 },
        { ...capture, sourceRevision: 1.5 }, { ...capture, sourceRevision: 2 },
        { ...capture, sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
        { ...capture, authorId: owner }, { ...capture, organizationId: otherOrg },
        { ...capture, createdAt: now.toISOString() },
      ]) {
        assert.throws(() => parseUpload({ ...valid, snapshot }), errorCode("invalid_document"));
      }
      const boundary = parseUpload({
        ...valid, snapshot: { ...capture, snapshotId: "a".repeat(120), note: "a".repeat(2_000) },
      });
      assert.equal(boundary.snapshot?.snapshotId.length, 120);
      assert.equal(boundary.snapshot?.note?.length, 2_000);
      for (const reason of ["manual", "before-restore", "before-pull", "publish"]) {
        const parsed = parseUpload({ ...valid, snapshot: { ...capture, reason, note: undefined } });
        assert.equal(parsed.snapshot?.reason, reason);
        assert.equal(parsed.snapshot?.note, undefined);
      }
      assert.deepEqual(parseUpload({ ...valid, snapshot: capture }).snapshot, normalizedCapture);
    });

    await t.test("metadata is immutable, normalized for retries, and separate from document hashing", async () => {
      const id = randomUUID();
      const legacy = payload();
      const first = await saveDesignVersion(db, org, id, owner, legacy);
      const upload = parseUpload({ ...legacy, uploadId: randomUUID(), expectedHeadGeneration: 1, snapshot: capture });
      const saved = await saveDesignVersion(db, org, id, owner, upload);
      assert.deepEqual(saved.savedVersion.snapshot, normalizedCapture);
      assert.equal(saved.savedVersion.contentHash, first.savedVersion.contentHash);
      const stored = await db.selectFrom("designVersion").selectAll()
        .where("id", "=", saved.savedVersion.id).executeTakeFirstOrThrow();
      assert.deepEqual(JSON.parse(stored.snapshot!), normalizedCapture);
      assert.equal(stored.requestHash, computeCanonicalContentHash(upload));
      const replay = await saveDesignVersion(db, org, id, owner, parseUpload({
        ...upload, snapshot: { ...normalizedCapture, note: " Approved baseline " },
      }));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.savedVersion, saved.savedVersion);
      assert.equal(replay.headGeneration, saved.headGeneration);
      for (const change of [
        { snapshotId: "other" }, { note: "Changed" }, { reason: "publish" },
        { takenAt: "2026-10-13T13:00:00Z" }, { note: undefined },
      ]) {
        await assert.rejects(saveDesignVersion(db, org, id, owner, parseUpload({
          ...upload, snapshot: { ...normalizedCapture, ...change },
        })), errorCode("upload_id_conflict"));
      }
      await assert.rejects(saveDesignVersion(db, org, id, owner, parseUpload({
        ...upload, snapshot: undefined,
      })), errorCode("upload_id_conflict"));
      await assert.rejects(saveDesignVersion(db, org, id, owner, parseUpload({
        ...upload, document: { ...upload.document, revision: 2 },
        snapshot: { ...normalizedCapture, sourceRevision: 2 },
      })), errorCode("upload_id_conflict"));
      await assert.rejects(saveDesignVersion(db, org, id, owner, parseUpload({
        ...legacy, snapshot: capture,
      })), errorCode("upload_id_conflict"));
      const unchanged = await db.selectFrom("designVersion").selectAll()
        .where("id", "=", saved.savedVersion.id).executeTakeFirstOrThrow();
      assert.deepEqual(unchanged, stored);
      assert.equal((await db.selectFrom("design").select("versionCount").where("id", "=", id)
        .executeTakeFirstOrThrow()).versionCount, 2);
      const newCapture = await saveDesignVersion(db, org, id, owner, parseUpload({
        ...upload, uploadId: randomUUID(), expectedHeadGeneration: saved.headGeneration,
      }));
      assert.notEqual(newCapture.savedVersion.id, saved.savedVersion.id);
      assert.equal(newCapture.savedVersion.contentHash, saved.savedVersion.contentHash);
      assert.deepEqual(newCapture.savedVersion.snapshot, normalizedCapture);
    });

    await t.test("strict validation, body limits, inline images, and missing preconditions", async () => {
      const valid = payload();
      for (const invalid of [
        { ...valid, expectedHeadGeneration: undefined },
        { ...valid, expectedHeadGeneration: -1 },
        { ...valid, expectedHeadGeneration: 1.5 },
        { ...valid, document: { ...valid.document, schemaVersion: 2 } },
        { ...valid, document: { ...valid.document, refs: { blobs: [42] } } },
        { ...valid, uploadId: "not-an-upload-id" },
      ]) {
        assert.throws(() => parseUpload(invalid), errorCode("invalid_document"));
      }
      assert.throws(() => parseUpload({
        ...valid, document: { ...valid.document, content: { image: "data:image/png;base64,AA==" } },
      }), errorCode("inline_media"));
      await assert.rejects(readDesignBody(new Request("http://localhost/", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "not json",
      })), errorCode("invalid_document"));
      await assert.rejects(readDesignBody(new Request("http://localhost/", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid),
      }), 16), errorCode("too_large"));
      const maxBytes = 2 * 1024 * 1024;
      const exact = JSON.stringify("x".repeat(maxBytes - 2));
      assert.equal(Buffer.byteLength(exact), maxBytes);
      assert.equal(typeof await readDesignBody(new Request("http://localhost/", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: exact,
      })), "string");
      await assert.rejects(readDesignBody(new Request("http://localhost/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify("x".repeat(maxBytes - 1)),
      })), errorCode("too_large"));
    });

    await t.test("first-create races and lost-response retries save exactly the intended versions", async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const raceId = randomUUID();
        const upload = payload();
        const retries = await Promise.all([
          saveDesignVersion(db, org, raceId, owner, upload),
          saveDesignVersion(db, org, raceId, owner, upload),
        ]);
        assert.equal(retries.filter((r) => r.replayed).length, 1);
        assert.equal(retries[0].savedVersion.id, retries[1].savedVersion.id);
        const distinctId = randomUUID();
        const firstPushes = await Promise.all([
          saveDesignVersion(db, org, distinctId, owner, payload(0, "A")),
          saveDesignVersion(db, org, distinctId, owner, payload(0, "B")),
        ]);
        assert.equal(firstPushes.filter((r) => r.outcome === "saved_and_preferred").length, 1);
        assert.equal(firstPushes.filter((r) => r.outcome === "saved_requires_selection").length, 1);
      }
      const identicalId = randomUUID();
      const firstCopy = await saveDesignVersion(db, org, identicalId, owner, payload(0, "Same document"));
      const secondCopy = await saveDesignVersion(db, org, identicalId, owner, payload(1, "Same document"));
      assert.notEqual(firstCopy.savedVersion.id, secondCopy.savedVersion.id);
      assert.equal(firstCopy.savedVersion.contentHash, secondCopy.savedVersion.contentHash);
      assert.equal(secondCopy.versionCount, 2);
      const futureId = randomUUID();
      await assert.rejects(saveDesignVersion(db, org, futureId, owner, payload(1)), errorCode("not_found"));
      assert.equal(await db.selectFrom("design").select("id").where("id", "=", futureId).executeTakeFirst(), undefined);
    });

    const designId = randomUUID();
    const firstPayload = payload();
    const first = await saveDesignVersion(db, org, designId, owner, firstPayload);
    await t.test("first push is preferred and retries are deduplicated", async () => {
      assert.equal(first.outcome, "saved_and_preferred");
      assert.equal(first.headGeneration, 1);
      const retries = await Promise.all(Array.from({ length: 4 }, () =>
        saveDesignVersion(db, org, designId, owner, firstPayload)));
      for (const retry of retries) {
        assert.equal(retry.replayed, true);
        assert.equal(retry.savedVersion.id, first.savedVersion.id);
        assert.equal(retry.versionCount, 1);
      }
      await assert.rejects(saveDesignVersion(db, org, designId, owner, {
        ...firstPayload, expectedHeadGeneration: 1,
      }), errorCode("upload_id_conflict"));
      await assert.rejects(saveDesignVersion(db, org, designId, owner, {
        ...firstPayload, document: { ...firstPayload.document, name: "Changed" },
      }), errorCode("upload_id_conflict"));
    });

    const concurrent = await Promise.all([
      saveDesignVersion(db, org, designId, owner, payload(1, "Computer A")),
      saveDesignVersion(db, org, designId, owner, payload(1, "Computer B")),
    ]);
    const candidate = concurrent.find((v) => v.outcome === "saved_requires_selection")!;
    await t.test("concurrent pushes preserve both versions and elect only one", async () => {
      assert.equal(concurrent.filter((v) => v.outcome === "saved_and_preferred").length, 1);
      assert.ok(candidate);
      const design = await db.selectFrom("design").selectAll().where("id", "=", designId).executeTakeFirstOrThrow();
      assert.equal(design.versionCount, 3);
      assert.equal(design.headGeneration, 2);
      const versions = await db.selectFrom("designVersion").selectAll().where("designId", "=", designId).execute();
      assert.deepEqual(versions.map((v) => v.number).sort(), [1, 2, 3]);
    });

    await t.test("winner election is atomic, versions survive, and stale ABA checkpoints fail", async () => {
      const before = await db.selectFrom("designVersion").selectAll().where("designId", "=", designId).orderBy("number").execute();
      const election = await electPreferredVersion(db, org, designId, owner, {
        versionId: candidate.savedVersion.id, expectedHeadGeneration: 2,
      });
      assert.equal(election.headGeneration, 3);
      const replay = await saveDesignVersion(db, org, designId, owner, firstPayload);
      assert.equal(replay.versionCount, 3);
      assert.equal(replay.preferredVersionId, candidate.savedVersion.id);
      assert.equal(replay.outcome, "saved_requires_selection");
      await electPreferredVersion(db, org, designId, owner, {
        versionId: first.savedVersion.id, expectedHeadGeneration: 3,
      });
      await electPreferredVersion(db, org, designId, owner, {
        versionId: candidate.savedVersion.id, expectedHeadGeneration: 4,
      });
      await assert.rejects(electPreferredVersion(db, org, designId, owner, {
        versionId: first.savedVersion.id, expectedHeadGeneration: 3,
      }), errorCode("head_conflict"));
      const outcomes = await Promise.allSettled([
        electPreferredVersion(db, org, designId, owner, { versionId: first.savedVersion.id, expectedHeadGeneration: 5 }),
        electPreferredVersion(db, org, designId, owner, { versionId: concurrent.find((v) => v.outcome === "saved_and_preferred")!.savedVersion.id, expectedHeadGeneration: 5 }),
      ]);
      assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((v) => v.status === "rejected").length, 1);
      const after = await db.selectFrom("designVersion").selectAll().where("designId", "=", designId).orderBy("number").execute();
      assert.deepEqual(after, before);
      const current = await db.selectFrom("design").selectAll().where("id", "=", designId).executeTakeFirstOrThrow();
      const noOp = await electPreferredVersion(db, org, designId, owner, {
        versionId: current.preferredVersionId!, expectedHeadGeneration: current.headGeneration,
      });
      assert.equal(noOp.headGeneration, current.headGeneration);
    });

    await t.test("missing blobs, nonowners, and cross-design/organization pointers cannot write", async () => {
      const missing = payload();
      missing.document.refs.blobs = ["a".repeat(64)];
      const missingId = randomUUID();
      await assert.rejects(saveDesignVersion(db, org, missingId, owner, missing), errorCode("missing_blobs"));
      assert.equal(await db.selectFrom("design").select("id").where("id", "=", missingId).executeTakeFirst(), undefined);
      await assert.rejects(saveDesignVersion(db, org, designId, otherUser, payload(6)), errorCode("forbidden"));
      await assert.rejects(saveDesignVersion(db, otherOrg, designId, owner, payload(6)), errorCode("not_found"));
      await assert.rejects(electPreferredVersion(db, org, legacyDesign, owner, {
        versionId: first.savedVersion.id, expectedHeadGeneration: 1,
      }), errorCode("not_found"));
      await assert.rejects(db.updateTable("design").set({ preferredVersionId: first.savedVersion.id })
        .where("id", "=", legacyDesign).execute(), /design_preferred_version_fk/);
    });

    await t.test("route discovery, pull, history, saved conflicts and auth boundaries", async () => {
      for (const [userId, sessionToken] of [[owner, token], [otherUser, readerToken]]) {
        await db.insertInto("member").values({
          id: randomUUID(), organizationId: org, userId, role: userId === owner ? "owner" : "member", createdAt: now,
        }).execute();
        await db.insertInto("session").values({
          id: randomUUID(), userId, token: sessionToken, expiresAt: new Date(Date.now() + 3600000),
          createdAt: now, updatedAt: now, ipAddress: null, userAgent: null, activeOrganizationId: null,
        }).execute();
      }
      const list = await import("../app/api/v1/organizations/[orgId]/designs/route");
      const detail = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/route");
      const history = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/versions/route");
      const historical = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/versions/[versionId]/route");
      const preferred = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/preferred/route");
      const limits = await import("../app/api/v1/organizations/[orgId]/limits/route");
      const context = { params: Promise.resolve({ orgId: org, designId }) };
      const request = (path = "", body?: unknown, sessionToken: string = token, method = body ? "POST" : "GET") => new Request(
        `http://localhost:3000/api/v1/organizations/${org}/designs${path}`, {
          method, headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const denied = await list.GET(request("", undefined, ""), context);
      assert.equal(denied.status, 401);
      const limitValues = await limits.GET(request(), context);
      assert.ok(limitValues);
      const advertised = await limitValues.json();
      assert.deepEqual(advertised.supportedDesignSchemaVersions, [1]);
      assert.equal(advertised.designSnapshotMetadata, true);
      assert.equal(advertised.maxBlobsPerDesign, 500);
      assert.equal((await history.POST(request("", payload(), ""), context)).status, 401);
      assert.equal((await preferred.PUT(request("", {
        versionId: first.savedVersion.id, expectedHeadGeneration: 6,
      }, "", "PUT"), context)).status, 401);
      assert.equal((await historical.GET(request("", undefined, ""), {
        params: Promise.resolve({ orgId: org, designId, versionId: first.savedVersion.id }),
      })).status, 401);
      const page = await list.GET(request("?limit=1"), context);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("cache-control"), "no-store");
      const pageData = await page.json();
      assert.equal(pageData.designs.length, 1);
      assert.ok(pageData.nextCursor);
      const secondPage = await list.GET(request(`?limit=1&cursor=${pageData.nextCursor}`), context);
      assert.notEqual((await secondPage.json()).designs[0].id, pageData.designs[0].id);
      assert.equal((await list.GET(request("?limit=500"), context)).status, 422);
      const pulled = await detail.GET(request(`/${designId}`), context);
      assert.equal(pulled.status, 200);
      assert.ok((await pulled.json()).version.document.content);
      const versions = await history.GET(request(`/${designId}/versions?limit=2`), context);
      const versionsData = await versions.json();
      assert.equal(versionsData.versions.length, 2);
      assert.equal(versionsData.nextCursor, "2");
      const lastPage = await history.GET(request(`/${designId}/versions?limit=2&cursor=2`), context);
      assert.deepEqual((await lastPage.json()).versions.map((v: { number: number }) => v.number), [1]);
      const emptyPage = await history.GET(request(`/${designId}/versions?cursor=1`), context);
      const emptyData = await emptyPage.json();
      assert.deepEqual(emptyData.versions, []);
      assert.equal(typeof emptyData.headGeneration, "number");
      const old = await historical.GET(request(), {
        params: Promise.resolve({ orgId: org, designId, versionId: first.savedVersion.id }),
      });
      assert.equal((await old.json()).version.document.name, "Computer A");
      const upload = payload(0, "Offline edits");
      const saved = await history.POST(request("", upload), context);
      assert.equal(saved.status, 201);
      const savedData = await saved.json();
      assert.equal(savedData.outcome, "saved_requires_selection");
      assert.equal((await history.POST(request("", upload), context)).status, 200);
      assert.equal((await history.POST(request("", payload(6), readerToken), context)).status, 403);
      assert.equal((await detail.GET(request("", undefined, readerToken), context)).status, 200);
      assert.equal((await historical.GET(request(), {
        params: Promise.resolve({ orgId: org, designId: legacyDesign, versionId: first.savedVersion.id }),
      })).status, 404);
      assert.equal((await detail.GET(request(), { params: Promise.resolve({ orgId: otherOrg, designId }) })).status, 403);
      assert.equal((await preferred.PUT(request("", {
        versionId: savedData.savedVersion.id, expectedHeadGeneration: 0,
      }, token, "PUT"), context)).status, 409);
      assert.equal((await preferred.PUT(request("", {
        versionId: savedData.savedVersion.id, expectedHeadGeneration: savedData.headGeneration,
      }, token, "PUT"), context)).status, 200);
      assert.equal((await preferred.PUT(request("", {
        versionId: savedData.savedVersion.id,
      }, token, "PUT"), context)).status, 422);
      assert.equal((await history.OPTIONS()).headers.get("access-control-allow-methods")?.includes("POST"), true);

      const metadataDesignId = randomUUID();
      const metadataContext = { params: Promise.resolve({ orgId: org, designId: metadataDesignId }) };
      const metadataUpload = { ...payload(), snapshot: capture };
      const receipt = await history.POST(request("", metadataUpload), metadataContext);
      assert.equal(receipt.status, 201);
      const receiptData = await receipt.json();
      assert.deepEqual(receiptData.savedVersion.snapshot, normalizedCapture);
      assert.equal(receiptData.savedVersion.authorId, owner);
      assert.notEqual(receiptData.savedVersion.createdAt, normalizedCapture.takenAt);
      const replay = await history.POST(request("", metadataUpload), metadataContext);
      assert.equal(replay.status, 200);
      assert.deepEqual((await replay.json()).savedVersion, receiptData.savedVersion);
      const metadataHistory = await history.GET(request(), metadataContext);
      assert.deepEqual((await metadataHistory.json()).versions[0].snapshot, normalizedCapture);
      const metadataPreferred = await detail.GET(request("", undefined, readerToken), metadataContext);
      assert.deepEqual((await metadataPreferred.json()).version.snapshot, normalizedCapture);
      const metadataExact = await historical.GET(request(), {
        params: Promise.resolve({ orgId: org, designId: metadataDesignId, versionId: receiptData.savedVersion.id }),
      });
      assert.deepEqual((await metadataExact.json()).version.snapshot, normalizedCapture);
      const metadataConflict = await history.POST(request("", {
        ...metadataUpload, snapshot: { ...capture, note: "Changed" },
      }), metadataContext);
      assert.equal(metadataConflict.status, 409);
      assert.equal((await metadataConflict.json()).error.code, "upload_id_conflict");
      assert.equal((await history.POST(request("", metadataUpload, readerToken), metadataContext)).status, 403);
      assert.equal((await historical.GET(request(), {
        params: Promise.resolve({ orgId: otherOrg, designId: metadataDesignId, versionId: receiptData.savedVersion.id }),
      })).status, 403);
      assert.equal((await history.POST(request("", {
        ...metadataUpload, snapshot: { ...capture, sourceRevision: 2 },
      }), metadataContext)).status, 422);

      const legacyHistory = await history.GET(request(), {
        params: Promise.resolve({ orgId: org, designId: legacyDesign }),
      });
      assert.equal(Object.hasOwn((await legacyHistory.json()).versions[0], "snapshot"), false);
      const legacyPreferred = await detail.GET(request(), {
        params: Promise.resolve({ orgId: org, designId: legacyDesign }),
      });
      assert.equal(Object.hasOwn((await legacyPreferred.json()).version, "snapshot"), false);
      const legacyExact = await historical.GET(request(), {
        params: Promise.resolve({ orgId: org, designId, versionId: first.savedVersion.id }),
      });
      assert.equal(Object.hasOwn((await legacyExact.json()).version, "snapshot"), false);
    });

    await t.test("historical pulls retain downloadable organization-scoped attachments", async () => {
      const bytes = Buffer.from("version attachment fixture");
      const hash = computeSha256(bytes);
      await db.insertInto("blob").values({
        organizationId: org, hash, contentType: "image/png", byteSize: bytes.byteLength, data: bytes,
      }).execute();
      const withImage = payload(0, "With image");
      withImage.document.refs.blobs = [hash];
      withImage.document.content = { nodes: [], image: `attachment:${hash}` };
      const imageDesignId = randomUUID();
      const saved = await saveDesignVersion(db, org, imageDesignId, owner, withImage);
      await saveDesignVersion(db, org, imageDesignId, owner, payload(1, "Without image"));
      const historical = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/versions/[versionId]/route");
      const result = await historical.GET(new Request("http://localhost/", {
        headers: { Authorization: `Bearer ${readerToken}` },
      }), { params: Promise.resolve({ orgId: org, designId: imageDesignId, versionId: saved.savedVersion.id }) });
      assert.equal(result.status, 200);
      assert.deepEqual((await result.json()).version.document.refs.blobs, [hash]);
      const blob = await import("../app/api/v1/organizations/[orgId]/blobs/[sha256]/route");
      const download = await blob.GET(new Request("http://localhost/", {
        headers: { Authorization: `Bearer ${readerToken}` },
      }), { params: Promise.resolve({ orgId: org, sha256: hash }) });
      assert.ok(download);
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
      const denied = await blob.GET(new Request("http://localhost/", {
        headers: { Authorization: `Bearer ${readerToken}` },
      }), { params: Promise.resolve({ orgId: otherOrg, sha256: hash }) });
      assert.ok(denied);
      assert.equal(denied.status, 403);
    });

    await t.test("organization cleanup cascades retained history", async () => {
      await db.deleteFrom("organization").where("id", "=", org).execute();
      assert.equal((await db.selectFrom("designVersion").selectAll().where("organizationId", "=", org).execute()).length, 0);
    });
    await t.test("account deletion still cascades owned designs and versions", async () => {
      const owned = await saveDesignVersion(db, otherOrg, randomUUID(), owner, payload());
      await db.deleteFrom("user").where("id", "=", owner).execute();
      assert.equal(await db.selectFrom("design").select("id").where("id", "=", owned.designId).executeTakeFirst(), undefined);
      assert.equal(await db.selectFrom("designVersion").select("id").where("id", "=", owned.savedVersion.id).executeTakeFirst(), undefined);
    });
  } finally {
    await appDb?.destroy();
    await database.destroy();
    process.env.DATABASE_URL = originalUrl;
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
