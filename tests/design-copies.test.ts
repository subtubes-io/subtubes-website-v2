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
import { up as versionSchema } from "../migrations/20261013000000_design_versions";
import { up as snapshotSchema } from "../migrations/20261014000000_design_snapshot_metadata";
import { up as imageSchema } from "../migrations/20261014000100_direct_image_uploads";
import { up as singleCopy, down as rollbackSingleCopy } from "../migrations/20261015000000_single_copy_designs";

loadEnvConfig(process.cwd());

test("designs and reports are one current copy: migration, replacement, ownership, compatibility and cloning", async (t) => {
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
  const otherToken = randomUUID();
  const preferredLegacy = randomUUID();
  const newestLegacy = randomUUID();
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
      for (const [id, name, revision] of [[preferredLegacy, "Preferred legacy", 7], [newestLegacy, "Older legacy", 3]] as const) {
        await sql`insert into "design" ("id", "organizationId", "ownerId", "name", "kind", "schemaVersion", "revision", "content", "refs")
          values (${id}, ${org}, ${owner}, ${name}, 'system', 1, ${revision}, '{"nodes":[]}', '{"blobs":[]}')`.execute(tx);
      }
      await versionSchema(tx);
      await snapshotSchema(tx);
      await imageSchema(tx);
      // Each legacy design later gained a newer saved version that was never chosen as the preferred one.
      for (const [id, number, name, revision] of [[preferredLegacy, 2, "Newer but not preferred", 9], [newestLegacy, 2, "Newest legacy", 4]] as const) {
        const document = { name, kind: "system", schemaVersion: 1, revision, content: { nodes: [] }, refs: { blobs: [] } };
        await sql`insert into "designVersion" ("id","designId","organizationId","number","uploadId","requestHash","contentHash","authorId",
          "name","kind","schemaVersion","revision","content","refs")
          values (${randomUUID()},${id},${org},${number},${randomUUID()},'x',${computeCanonicalContentHash(document)},${owner},
          ${name},'system',1,${revision},'{"nodes":[]}','{"blobs":[]}')`.execute(tx);
      }
      // One design has lost its preferred pointer, so the newest version has to be used.
      await sql`update "design" set "preferredVersionId" = null where "id" = ${newestLegacy}`.execute(tx);
      await singleCopy(tx);
    });

    const {
      parseUpload, saveDesign, cloneDesign, designRead, designSummary, DesignError,
    } = await import("../lib/cloud-push/designs");
    appDb = (await import("../lib/db/client")).db;
    const payload = (name = "Computer A", revision = 1, blobs: string[] = [], content: Record<string, unknown> = {}) => parseUpload({
      deviceLabel: name,
      document: {
        name, kind: "swimlane", schemaVersion: 1, revision,
        content: { name, kind: "swimlane", nodes: [], links: [], groups: [], ...content }, refs: { blobs },
      },
    });
    const errorCode = (code: string) => (error: unknown) => error instanceof DesignError && error.code === code;
    const reader = { versions: [1], explicit: false };
    const explicit = { versions: [1], explicit: true };

    await t.test("migration moves each design's current content back onto the design and keeps the old versions untouched", async () => {
      const preferred = await db.selectFrom("design").selectAll().where("id", "=", preferredLegacy).executeTakeFirstOrThrow();
      assert.equal(preferred.name, "Preferred legacy", "the preferred version is the current copy, not the newest");
      assert.equal(preferred.revision, 7);
      assert.deepEqual(JSON.parse(preferred.content), { nodes: [] });
      assert.match(preferred.contentHash, /^sha256:[a-f0-9]{64}$/);
      const newest = await db.selectFrom("design").selectAll().where("id", "=", newestLegacy).executeTakeFirstOrThrow();
      assert.equal(newest.name, "Newest legacy", "without a preferred version the newest one is used");
      assert.equal(newest.revision, 4);
      assert.equal((await db.selectFrom("designVersion").selectAll().execute()).length, 4, "old versions are left in place");
      assert.equal(designRead(preferred, reader).document.name, "Preferred legacy");
      await assert.rejects(rollbackSingleCopy(), /cannot be discarded/);
    });

    const designId = randomUUID();
    await t.test("a push creates the design and the next push replaces it: one copy, last write wins", async () => {
      const created = await saveDesign(db, org, designId, owner, payload("Computer A", 1), reader);
      assert.equal(created.created, true);
      assert.equal(created.contentHash, computeCanonicalContentHash(payload("Computer A", 1).document));
      const replaced = await saveDesign(db, org, designId, owner, payload("Computer B", 2, [], { note: "later" }), reader);
      assert.equal(replaced.created, false);
      assert.notEqual(replaced.contentHash, created.contentHash);
      assert.deepEqual(Object.keys(replaced).sort(), ["contentHash", "created", "designId", "success", "updatedAt"]);
      const stored = await db.selectFrom("design").selectAll().where("id", "=", designId).executeTakeFirstOrThrow();
      const read = designRead(stored, reader);
      assert.equal(read.document.name, "Computer B");
      assert.equal(read.document.revision, 2);
      assert.equal(stored.deviceLabel, "Computer B");
      assert.equal(read.contentHash, replaced.contentHash);
      assert.equal((await db.selectFrom("designVersion").select("id").where("designId", "=", designId).execute()).length, 0,
        "pushing never writes version history");
      // A slower computer that pushes an older revision still wins: there is no conflict step.
      await saveDesign(db, org, designId, owner, payload("Slow computer", 1), reader);
      assert.equal(designRead(await db.selectFrom("design").selectAll().where("id", "=", designId).executeTakeFirstOrThrow(), reader).document.name, "Slow computer");
    });

    await t.test("two first pushes at once both succeed: one creates, the other replaces", async () => {
      const id = randomUUID();
      const results = await Promise.all([
        saveDesign(db, org, id, owner, payload("First", 1), reader),
        saveDesign(db, org, id, owner, payload("Second", 2), reader),
      ]);
      assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
      assert.equal((await db.selectFrom("design").select("id").where("id", "=", id).execute()).length, 1);
    });

    await t.test("only the owner replaces a design, other organizations cannot see it, and blobs must exist first", async () => {
      await assert.rejects(saveDesign(db, org, designId, otherUser, payload("Intruder"), reader), errorCode("forbidden"));
      await assert.rejects(saveDesign(db, otherOrg, designId, owner, payload("Wrong organization"), reader), errorCode("not_found"));
      await assert.rejects(cloneDesign(db, otherOrg, designId, owner, reader), errorCode("not_found"));
      await assert.rejects(saveDesign(db, org, randomUUID(), owner, payload("Missing image", 1, ["a".repeat(64)], {
        image: `attachment:${"a".repeat(64)}`,
      }), reader), errorCode("missing_blobs"));
      assert.throws(() => parseUpload({ document: { ...payload().document, content: { image: "data:image/png;base64,AA==" } } }), errorCode("inline_media"));
      assert.throws(() => parseUpload({ uploadId: randomUUID(), expectedHeadGeneration: 0, document: payload().document }), errorCode("invalid_document"));
      assert.throws(() => parseUpload({ document: { ...payload().document, schemaVersion: 2 } }), errorCode("unsupported_schema_version"));
      assert.equal(designRead(await db.selectFrom("design").selectAll().where("id", "=", designId).executeTakeFirstOrThrow(), reader).document.name, "Slow computer");
    });

    await t.test("a cloned design is independent: new ID, owned by the cloner, named Copy of, at revision 1", async () => {
      const bytes = Buffer.from("clone attachment fixture");
      const hash = computeSha256(bytes);
      await db.insertInto("blob").values({ organizationId: org, hash, contentType: "image/png", byteSize: bytes.byteLength, data: bytes }).execute();
      const sourceId = randomUUID();
      await saveDesign(db, org, sourceId, owner, payload("Architecture", 5, [hash], { image: `attachment:${hash}` }), reader);
      const copy = await cloneDesign(db, org, sourceId, otherUser, reader);
      assert.notEqual(copy.designId, sourceId);
      assert.equal(copy.name, "Copy of Architecture");
      const stored = await db.selectFrom("design").selectAll().where("id", "=", copy.designId).executeTakeFirstOrThrow();
      assert.equal(stored.ownerId, otherUser);
      assert.equal(stored.organizationId, org);
      assert.equal(stored.revision, 1);
      const read = designRead(stored, reader);
      assert.equal(read.document.content.name, "Copy of Architecture");
      assert.deepEqual(read.document.refs.blobs, [hash], "the copy keeps the same organization images");
      assert.equal(read.contentHash, copy.contentHash);
      await saveDesign(db, org, sourceId, owner, payload("Architecture v2", 6, [hash], { image: `attachment:${hash}` }), reader);
      assert.equal(designRead(await db.selectFrom("design").selectAll().where("id", "=", copy.designId).executeTakeFirstOrThrow(), reader).document.name, "Copy of Architecture");
      // The new owner can replace their copy; the original owner cannot.
      await saveDesign(db, org, copy.designId, otherUser, payload("Mine now", 2, [hash], { image: `attachment:${hash}` }), reader);
      await assert.rejects(saveDesign(db, org, copy.designId, owner, payload("Not yours"), reader), errorCode("forbidden"));
    });

    await t.test("newer-schema and damaged designs stay visible but are never read, replaced or cloned", async () => {
      const id = randomUUID();
      await saveDesign(db, org, id, owner, payload("Future"), reader);
      await db.updateTable("design").set({ schemaVersion: 2, content: '{"futureField":true}' }).where("id", "=", id).execute();
      const row = () => db.selectFrom("design").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      assert.equal(designSummary(await row(), explicit).compatibility?.status, "unsupported");
      await assert.rejects(async () => designRead(await row(), reader), errorCode("upgrade_required"));
      await assert.rejects(saveDesign(db, org, id, owner, payload("Replace future"), reader), errorCode("upgrade_required"));
      await assert.rejects(cloneDesign(db, org, id, owner, reader), errorCode("upgrade_required"));
      assert.equal((await row()).content, '{"futureField":true}', "the newer copy is untouched");
      await db.updateTable("design").set({ schemaVersion: 1, content: "broken" }).where("id", "=", id).execute();
      assert.equal(designSummary(await row(), explicit).compatibility?.status, "invalid");
      await assert.rejects(async () => designRead(await row(), reader), errorCode("invalid_document"));
      await assert.rejects(saveDesign(db, org, id, owner, payload("Replace damaged"), reader), errorCode("invalid_document"));
      await db.updateTable("design").set({ content: '{"nodes":[]}', contentHash: "sha256:wrong" }).where("id", "=", id).execute();
      await assert.rejects(async () => designRead(await row(), reader), errorCode("invalid_document"));
    });

    await t.test("design routes: auth, list, read, replace, clone and no history endpoints", async () => {
      for (const [userId, sessionToken] of [[owner, token], [otherUser, otherToken]]) {
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
      const clone = await import("../app/api/v1/organizations/[orgId]/designs/[designId]/clone/route");
      const limits = await import("../app/api/v1/organizations/[orgId]/limits/route");
      const url = (path = "") => `http://localhost:3000/api/v1/organizations/${org}/designs${path}`;
      const call = (sessionToken: string, init: RequestInit = {}, path = "") => new Request(url(path), {
        ...init, headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
      });
      const context = (id: string = designId) => ({ params: Promise.resolve({ orgId: org, designId: id }) });
      assert.equal((await list.GET(call(""), context())).status, 401);
      assert.equal((await detail.PUT(call("", { method: "PUT", body: "{}" }), context())).status, 401);
      assert.equal((await clone.POST(call("", { method: "POST" }), context())).status, 401);

      const advertised = await (await limits.GET(call(token), context()))!.json();
      assert.deepEqual(advertised.supportedDesignSchemaVersions, [1]);
      assert.equal(advertised.maxBlobsPerDesign, 500);
      assert.equal(Object.hasOwn(advertised, "designSnapshotMetadata"), false);
      assert.equal(Object.hasOwn(advertised, "maxSnapshotsPerReport"), false);

      const id = randomUUID();
      const put = (sessionToken: string, body: unknown, target = id) => detail.PUT(
        call(sessionToken, { method: "PUT", body: JSON.stringify(body) }, `/${target}`), context(target));
      const body = (name: string, revision: number) => ({ document: payload(name, revision).document });
      const first = await put(token, body("Route design", 1));
      assert.equal(first!.status, 201);
      const second = await put(token, body("Route design v2", 2));
      assert.equal(second!.status, 200);
      assert.equal((await second!.json()).created, false);
      assert.equal((await put(otherToken, body("Intruder", 3)))!.status, 403);
      assert.equal((await put(token, { document: payload().document, uploadId: randomUUID() }))!.status, 422);
      const read = await detail.GET(call(otherToken, {}, `/${id}`), context(id));
      assert.equal(read!.status, 200);
      const readBody = await read!.json();
      assert.deepEqual(Object.keys(readBody).sort(), ["contentHash", "designId", "document", "ownerId", "success", "updatedAt"]);
      assert.equal(readBody.document.name, "Route design v2");
      assert.equal(readBody.ownerId, owner);

      const copy = await clone.POST(call(otherToken, { method: "POST" }, `/${id}/clone`), context(id));
      assert.equal(copy!.status, 201);
      const copyBody = await copy!.json();
      assert.equal(copyBody.name, "Copy of Route design v2");
      const page = await list.GET(call(token, { headers: { "X-Subtubes-Design-Schema-Versions": "1" } }, "?limit=100"), context());
      const listed = (await page.json()).designs as { id: string; name: string; ownerId: string; compatibility?: { status: string } }[];
      assert.ok(listed.some((item) => item.id === copyBody.designId && item.ownerId === otherUser));
      assert.ok(listed.every((item) => item.compatibility?.status), "an explicit reader gets compatibility for every design");
      assert.equal(Object.hasOwn(listed[0], "versionCount"), false);
      assert.equal(Object.hasOwn(listed[0], "preferredVersionId"), false);
      assert.equal((await list.GET(call(token, {}, "?limit=500"), context())).status, 422);
      const missing = await detail.GET(call(token, {}, "/nope"), context("nope"));
      assert.equal(missing!.status, 404);
      const foreign = await list.GET(new Request(url(), { headers: { Authorization: `Bearer ${token}` } }), { params: Promise.resolve({ orgId: otherOrg }) });
      assert.equal(foreign.status, 403);
    });

    await t.test("reports are one current copy too: replace without If-Match, owner only, unreadable never replaced, and clone", async () => {
      const { parseReportUpload, saveReport, cloneReport, reportDocument } = await import("../lib/cloud-push/reports");
      const { readWebsiteReport } = await import("../lib/report-reader");
      const { reportFixture } = await import("../report-ui/src/fixtures");
      const wire = { versions: [2], explicit: true };
      const id = randomUUID();
      const upload = (title: string, revision: number) => parseReportUpload({
        schemaVersion: 2, revision, contentHash: `hash-${revision}`, project: { name: "Metadata name" },
        report: { title, futureExtension: { preserved: true } }, refs: { blobs: [], designs: [] },
      });
      await saveReport(db, org, id, owner, upload("First", 1), wire);
      await saveReport(db, org, id, owner, upload("Second", 2), wire);
      await saveReport(db, org, id, owner, upload("From a slower computer", 1), wire);
      let row = await db.selectFrom("report").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      assert.equal(row.revision, 1);
      assert.equal((reportDocument(row, wire) as { title: string }).title, "From a slower computer");
      await assert.rejects(saveReport(db, org, id, otherUser, upload("Intruder", 5), wire), errorCode("forbidden"));
      await assert.rejects(saveReport(db, otherOrg, id, owner, upload("Wrong org", 5), wire), errorCode("not_found"));
      await assert.rejects(saveReport(db, org, randomUUID(), owner, parseReportUpload({
        schemaVersion: 2, revision: 1, contentHash: "h", report: {}, refs: { blobs: [], designs: [{ id: randomUUID() }] },
      }), wire), errorCode("missing_designs"));
      assert.equal(typeof (await db.selectFrom("report").select("id").where("id", "=", id).executeTakeFirst())?.id, "string");

      const copy = await cloneReport(db, org, id, otherUser, wire);
      assert.notEqual(copy.reportId, id);
      assert.equal(copy.name, "Copy of From a slower computer");
      assert.equal(copy.revision, 1);
      const copyRow = await db.selectFrom("report").selectAll().where("id", "=", copy.reportId).executeTakeFirstOrThrow();
      assert.equal(copyRow.ownerId, otherUser);
      assert.deepEqual((reportDocument(copyRow, wire) as { futureExtension: unknown }).futureExtension, { preserved: true }, "unknown fields are kept");
      await saveReport(db, org, id, owner, upload("Original changes later", 3), wire);
      assert.equal((reportDocument(await db.selectFrom("report").selectAll().where("id", "=", copy.reportId).executeTakeFirstOrThrow(), wire) as { title: string }).title, "Copy of From a slower computer");
      await assert.rejects(cloneReport(db, otherOrg, id, owner, wire), errorCode("not_found"));

      await db.updateTable("report").set({ schemaVersion: 3 }).where("id", "=", id).execute();
      await assert.rejects(saveReport(db, org, id, owner, upload("Replace newer", 9), wire), errorCode("upgrade_required"));
      await assert.rejects(cloneReport(db, org, id, owner, wire), errorCode("upgrade_required"));
      row = await db.selectFrom("report").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      assert.equal(row.schemaVersion, 3);
      assert.equal(row.revision, 3);

      const reportList = await import("../app/api/v1/organizations/[orgId]/reports/route");
      const response = await reportList.GET(new Request(`http://localhost:3000/api/v1/organizations/${org}/reports`, {
        headers: { Authorization: `Bearer ${token}`, "X-Subtubes-Report-Schema-Versions": "2" },
      }), { params: Promise.resolve({ orgId: org }) });
      const reports = (await response.json()).reports as Record<string, unknown>[];
      assert.ok(reports.length >= 2);
      assert.ok(reports.every((report) => !("snapshots" in report)), "the list no longer reports snapshots");
      const cloneRoute = await import("../app/api/v1/organizations/[orgId]/reports/[reportId]/clone/route");
      const routed = await cloneRoute.POST(new Request("http://localhost/", { method: "POST", headers: { Authorization: `Bearer ${otherToken}` } }),
        { params: Promise.resolve({ orgId: org, reportId: copy.reportId }) });
      assert.equal(routed!.status, 201);
      assert.equal((await routed!.json()).name, "Copy of Copy of From a slower computer");

      const stored = { ...copyRow, id: randomUUID(), report: JSON.stringify(reportFixture()), schemaVersion: 2, refs: '{"blobs":[],"designs":[]}' };
      const decoded = readWebsiteReport(stored);
      assert.equal(decoded.compatibility.status, "supported");
      assert.equal("commit" in decoded, false);
    });

    await t.test("organization and account deletion cascade the current copies", async () => {
      await db.deleteFrom("user").where("id", "=", otherUser).execute();
      assert.equal((await db.selectFrom("design").select("id").where("ownerId", "=", otherUser).execute()).length, 0);
      assert.equal((await db.selectFrom("report").select("id").where("ownerId", "=", otherUser).execute()).length, 0);
      await db.deleteFrom("organization").where("id", "=", org).execute();
      assert.equal((await db.selectFrom("design").select("id").where("organizationId", "=", org).execute()).length, 0);
      assert.equal((await db.selectFrom("report").select("id").where("organizationId", "=", org).execute()).length, 0);
    });
  } finally {
    await appDb?.destroy();
    await database.destroy();
    process.env.DATABASE_URL = originalUrl;
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
