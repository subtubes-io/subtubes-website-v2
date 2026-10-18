import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "../lib/db/types";
import { ReviewError } from "../lib/reviews/errors";
import { blobClaims, canonicalJson, limits, manifestHash, parseManifest } from "../lib/reviews/manifest";
import { Reviews } from "../lib/reviews/service";
import { collectReviews } from "../lib/reviews/gc";
import { ReviewStorageError, type ReviewStorage } from "../lib/reviews/storage";
import { down as rollback, up as migrateReviews } from "../migrations/20261018000000_private_reviews";

const bytes = Buffer.from("synthetic opaque report bytes");
const hash = createHash("sha256").update(bytes).digest("hex");
function manifest(suffix = "") {
  return {
    manifestSchemaVersion: 1,
    client: { app: "subtubes-desktop", version: "1" },
    repo: { key: "a".repeat(40), remoteUrl: "git@github.com:example/repository.git" },
    review: { title: `Example${suffix}`, sourceBranch: "feature", targetBranch: "main" },
    revision: { baseSha: "a".repeat(40), headSha: "b".repeat(40), commitCount: 1, fileCount: 1 },
    code: { transport: "remote" },
    reports: [{
      clientId: "local-report", kind: "commit", commit: "b".repeat(40), schemaVersion: 1,
      title: "Example report", featureCount: 1, issueCount: 0, createdAt: "2026-10-17T00:00:00.000Z",
      blobs: { report: { hash, bytes: bytes.length } },
    }],
  };
}
test("manifest canonical contract, privacy-safe URL normalization and strict validation", () => {
  const parsed = parseManifest(manifest());
  assert.equal(parsed.repo.remoteUrl, "https://github.com/example/repository");
  assert.equal(manifestHash(parsed), manifestHash(parseManifest(JSON.parse(canonicalJson(manifest())))));
  assert.equal(blobClaims(parsed).length, 1);
  assert.throws(() => parseManifest({ ...manifest(), unknown: true }), ReviewError);
  assert.throws(() => parseManifest({ ...manifest(), client: { ...manifest().client, extra: true } }), ReviewError);
  assert.throws(() => parseManifest({ ...manifest(), repo: { ...manifest().repo, remoteUrl: "https://secret:password@example.com/repo" } }),
    (error: unknown) => error instanceof ReviewError && !error.message.includes("password"));
  assert.throws(() => parseManifest({ ...manifest(), revision: { ...manifest().revision, headSha: "a".repeat(40) } }), ReviewError);
  assert.throws(() => parseManifest({ ...manifest(), reports: [manifest().reports[0], manifest().reports[0]] }), ReviewError);
  assert.throws(() => parseManifest({ ...manifest(), reports: [{
    ...manifest().reports[0], blobs: { report: { hash, bytes: 16777217 } },
  }] }), (e: unknown) => e instanceof ReviewError && e.status === 413);
});

const connectionString = process.env.REVIEWS_TEST_DATABASE_URL;
test("private reviews database contract", {
  skip: !connectionString && "Set REVIEWS_TEST_DATABASE_URL to a disposable localhost database.",
}, async (t) => {
  assert.ok(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname), "Never run fixtures on a hosted database.");
  const schema = `reviews_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, options: `-c search_path=${schema}`, max: 5 }) }),
  });
  const objects = new Map<string, Buffer>();
  const minted: string[] = [];
  let failDelete = false;
  let beforeVerify: (() => Promise<void>) | undefined;
  const storage: ReviewStorage = {
    async mintUpload(storagePath, size, contentType, expiresAt) {
      minted.push(storagePath);
      assert.equal(size, bytes.length);
      assert.equal(contentType, "application/gzip");
      return { method: "PUT", url: `https://private.example.test/${storagePath}`, headers: { "Content-Type": contentType }, expiresAt: expiresAt.toISOString() };
    },
    async mintDownload(storagePath) { return `https://private.example.test/${storagePath}?signature=test`; },
    async verify(storagePath, expectedHash, size) {
      if (beforeVerify) await beforeVerify();
      const content = objects.get(storagePath);
      if (!content) throw new ReviewStorageError("OBJECT_NOT_FOUND", "Missing object.");
      if (content.length !== size || createHash("sha256").update(content).digest("hex") !== expectedHash) {
        throw new ReviewStorageError("CONTENT_MISMATCH", "Invalid uploaded object.");
      }
    },
    async delete(storagePath) {
      if (failDelete) throw new ReviewStorageError("PROVIDER_ERROR", "Delete failed.");
      objects.delete(storagePath);
    },
    async list(prefix) { return [...objects.keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, uploadedAt: new Date() })); },
  };
  const api = new Reviews(db, storage);
  const owner = { id: "author", name: "Example author" };
  const reviewer = { id: "reviewer", name: "Example reviewer" };
  const outsider = { id: "outsider", name: "Outside user" };
  const orgAdmin = { id: "admin", name: "Example admin" };
  let reviewId = "", revisionId = "";
  try {
    const migrator = new Migrator({
      db, migrationTableSchema: schema,
      provider: new FileMigrationProvider({ fs, path, migrationFolder: path.join(process.cwd(), "migrations") }),
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
    await t.test("empty migration rolls down and reapplies without touching retained tables", async () => {
      await rollback(db);
      await migrateReviews(db);
      assert.equal((await db.selectFrom("reviewClock").select("value").executeTakeFirstOrThrow()).value, "0");
      assert.equal((await db.selectFrom("member").selectAll().execute()).length, 0);
    });
    for (const user of [owner, reviewer, outsider, orgAdmin]) {
      await db.insertInto("user").values({ id: user.id, name: user.name, email: `${user.id}@example.test`,
        image: null, username: null, displayUsername: null }).execute();
    }
    await db.insertInto("organization").values([
      { id: "org-a", name: "Organization A", slug: "org-a", createdAt: new Date(), logo: null, metadata: null },
      { id: "org-b", name: "Organization B", slug: "org-b", createdAt: new Date(), logo: null, metadata: null },
    ]).execute();
    for (const [userId, org, role] of [
      ["author", "org-a", "member"], ["reviewer", "org-a", "member"],
      ["admin", "org-a", "owner"], ["outsider", "org-b", "owner"],
    ]) await db.insertInto("member").values({ id: `${org}-${userId}`, userId, organizationId: org, role, createdAt: new Date() }).execute();

    await t.test("nonmembers cannot inspect organization limits/usage, push or list", async () => {
      for (const action of [
        () => api.capabilities(outsider, "org-a"), () => api.usage(outsider, "org-a"),
        () => api.push(outsider, { organizationId: "org-a", manifest: manifest() }),
        () => api.list(outsider, new URLSearchParams({ organizationId: "org-a", role: "all" })),
      ]) await assert.rejects(action(), (e: unknown) => e instanceof ReviewError && e.status === 404);
    });
    await t.test("concurrent retries create one revision and persist report organization/owner", async () => {
      const results = await Promise.all([1, 2].map(() => api.push(owner, {
        organizationId: "org-a", manifest: manifest(), reviewerUserIds: [reviewer.id],
      })));
      assert.equal(results[0].body.revision.id, results[1].body.revision.id);
      reviewId = results[0].body.review.id; revisionId = results[0].body.revision.id;
      const report = await db.selectFrom("reviewReport").selectAll().executeTakeFirstOrThrow();
      assert.equal(report.organizationId, "org-a");
      assert.equal(report.ownerId, owner.id);
      assert.equal(report.ownerName, owner.name);
      assert.equal(report.clientId, "local-report");
      assert.equal((await api.usage(owner, "org-a")).reservedBytes, bytes.length);
      assert.equal(new Set(minted).size, 1, "Concurrent retry reuses its active intent.");
      const revision = await db.selectFrom("reviewRevision").selectAll().execute();
      assert.equal(revision.length, 1);
      await assert.rejects(rollback(db), /Cannot discard/);
    });
    await t.test("completion checks size and digest, then publishes idempotently", async () => {
      await assert.rejects(api.complete(owner, reviewId, 1), (e: unknown) => e instanceof ReviewError && e.code === "blobs_missing");
      objects.set(minted[0], Buffer.from("x".repeat(bytes.length)));
      await assert.rejects(api.complete(owner, reviewId, 1), (e: unknown) => e instanceof ReviewError && e.code === "blobs_missing");
      objects.set(minted[0], bytes);
      const [complete] = await Promise.all([api.complete(owner, reviewId, 1), api.complete(owner, reviewId, 1)]);
      assert.equal(complete.revision.state, "complete");
      assert.equal((await api.complete(owner, reviewId, 1)).revision.id, revisionId);
      assert.equal((await api.usage(owner, "org-a")).storageBytes, bytes.length);
      assert.equal((await api.get(reviewer, reviewId)).reports[0].ownerId, owner.id);
      assert.match(await api.download(reviewer, reviewId, hash), /private\.example/);
    });
    await t.test("read permissions do not grant author mutations; admin status-only", async () => {
      await assert.rejects(api.complete(reviewer, reviewId, 1), (e: unknown) => e instanceof ReviewError && e.status === 403);
      await assert.rejects(api.patch(reviewer, reviewId, { title: "Other" }), (e: unknown) => e instanceof ReviewError && e.status === 403);
      await assert.rejects(api.patch(orgAdmin, reviewId, { addReviewerUserIds: [outsider.id] }),
        (e: unknown) => e instanceof ReviewError && e.status === 403);
      await assert.rejects(api.patch(owner, reviewId, { addReviewerUserIds: [outsider.id] }),
        (e: unknown) => e instanceof ReviewError && e.status === 404);
      await api.seen(reviewer, reviewId, { revision: 1 });
      assert.equal((await db.selectFrom("reviewParticipant").select("lastSeenRevision").where("reviewId", "=", reviewId)
        .where("userId", "=", reviewer.id).executeTakeFirstOrThrow()).lastSeenRevision, 1);
    });
    await t.test("dedup is organization-scoped and matching reports have server ownership", async () => {
      const sameOrg = await api.push(owner, { organizationId: "org-a", manifest: manifest(" changed") });
      assert.equal(sameOrg.body.missing.length, 0);
      assert.equal(sameOrg.body.revision.state, "complete");
      const other = await api.push(outsider, { organizationId: "org-b", manifest: manifest() });
      assert.equal(other.body.missing.length, 1);
      assert.notEqual(other.body.missing[0].upload.url, minted[0]);
      await assert.rejects(api.download(reviewer, other.body.review.id, hash), (e: unknown) => e instanceof ReviewError && e.status === 404);
      for (const action of [
        () => api.get(outsider, reviewId), () => api.complete(outsider, reviewId, 1),
        () => api.patch(outsider, reviewId, { status: "closed" }), () => api.remove(outsider, reviewId),
        () => api.download(outsider, reviewId, hash), () => api.seen(outsider, reviewId, { revision: 1 }),
      ]) await assert.rejects(action(), (e: unknown) => e instanceof ReviewError && e.status === 404);
    });
    await t.test("out-of-order completion never rolls latest or seen backwards", async () => {
      const revisions = [];
      for (const letter of ["c", "d"]) {
        const content = Buffer.alloc(bytes.length, letter);
        const nextHash = createHash("sha256").update(content).digest("hex");
        const next = await api.push(owner, { organizationId: "org-a", manifest: {
          ...manifest(` ${letter}`), reports: [{ ...manifest().reports[0], blobs: { report: { hash: nextHash, bytes: content.length } } }],
        } });
        const intent = await db.selectFrom("reviewUpload").select("storagePath").where("revisionId", "=", next.body.revision.id).executeTakeFirstOrThrow();
        objects.set(intent.storagePath, content);
        revisions.push(next.body.revision);
      }
      await api.complete(owner, reviewId, revisions[1].number);
      await api.complete(owner, reviewId, revisions[0].number);
      assert.equal((await api.get(owner, reviewId)).latestRevisionId, revisions[1].id);
      assert.deepEqual(await api.seen(reviewer, reviewId, { revision: revisions[1].number }), { seen: revisions[1].number });
      assert.deepEqual(await api.seen(reviewer, reviewId, { revision: 1 }), { seen: revisions[1].number });
    });
    await t.test("verification batches persist progress and never publish after membership removal", async () => {
      const payloads = Array.from({ length: 9 }, (_, index) => Buffer.alloc(bytes.length, index));
      const reports = payloads.map((content, index) => ({
        ...manifest().reports[0], clientId: `batch-${index}`,
        blobs: { report: { hash: createHash("sha256").update(content).digest("hex"), bytes: content.length } },
      }));
      const pending = await api.push(owner, { organizationId: "org-a", manifest: { ...manifest(" batch"), reports } });
      const intents = await db.selectFrom("reviewUpload").selectAll().where("revisionId", "=", pending.body.revision.id).execute();
      for (const intent of intents) objects.set(intent.storagePath, payloads.find((content) => createHash("sha256").update(content).digest("hex") === intent.hash)!);
      const partial = await api.complete(owner, reviewId, pending.body.revision.number);
      assert.equal(partial.verifying, true);
      assert.equal(partial.revision.state, "pending");
      let entered!: () => void, release!: () => void;
      const verifying = new Promise<void>((resolve) => { entered = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      beforeVerify = async () => { entered(); await released; };
      const completion = api.complete(owner, reviewId, pending.body.revision.number);
      try {
        await verifying;
        await db.deleteFrom("member").where("id", "=", "org-a-author").execute();
        release();
        await assert.rejects(completion, (e: unknown) => e instanceof ReviewError && e.status === 404);
        assert.equal((await db.selectFrom("reviewRevision").select("state").where("id", "=", pending.body.revision.id).executeTakeFirstOrThrow()).state, "pending");
      } finally {
        release();
        beforeVerify = undefined;
        await db.insertInto("member").values({
          id: "org-a-author", userId: owner.id, organizationId: "org-a", role: "member", createdAt: new Date(),
        }).onConflict((c) => c.column("id").doNothing()).execute();
      }
      assert.equal((await api.complete(owner, reviewId, pending.body.revision.number)).verifying, false);
    });
    await t.test("quota reservations serialize concurrent uploads and failures roll back", async () => {
      await db.insertInto("organization").values({
        id: "quota-org", name: "Quota fixture", slug: "quota-org", createdAt: new Date(), logo: null, metadata: null,
      }).execute();
      await db.insertInto("member").values({
        id: "quota-member", userId: owner.id, organizationId: "quota-org", role: "owner", createdAt: new Date(),
      }).execute();
      await db.insertInto("reviewBlob").values(Array.from({ length: Math.ceil(limits.orgStorageBytes / 104857600) }, (_, index) => ({
        organizationId: "quota-org", hash: createHash("sha256").update(`quota-${index}`).digest("hex"),
        byteSize: String(Math.min(104857600, limits.orgStorageBytes - index * 104857600) - (index === 0 ? bytes.length : 0)),
        contentType: "application/gzip",
      }))).execute();
      const attempts = await Promise.allSettled(["e", "f"].map((letter) => api.push(owner, {
        organizationId: "quota-org", manifest: { ...manifest(letter),
          review: { ...manifest().review, sourceBranch: letter },
          reports: [{ ...manifest().reports[0], blobs: { report: { hash: letter.repeat(64), bytes: bytes.length } } }],
        },
      })));
      assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
      const denied = attempts.find((attempt) => attempt.status === "rejected");
      assert.ok(denied?.status === "rejected" && denied.reason instanceof ReviewError && denied.reason.code === "quota_exceeded");
      const usage = await api.usage(owner, "quota-org");
      assert.equal(usage.reservedBytes, limits.orgStorageBytes);
      assert.equal(usage.reviewCount, 1);
      await db.deleteFrom("organization").where("id", "=", "quota-org").execute();
    });
    await t.test("conflicting claims and mismatched organization children are rejected", async () => {
      await assert.rejects(api.push(owner, { organizationId: "org-a", manifest: {
        ...manifest(" conflicting"), reports: [{ ...manifest().reports[0], blobs: { report: { hash, bytes: bytes.length + 1 } } }],
      } }), (e: unknown) => e instanceof ReviewError && e.code === "blob_conflict");
      await assert.rejects(db.insertInto("reviewReport").values({
        id: "invalid-report", organizationId: "org-b", revisionId, ownerId: owner.id,
        ownerName: owner.name, clientId: "invalid", kind: "commit", title: "Invalid", envelope: parseManifest(manifest()).reports[0],
      }).execute(), /foreign key/);
      await assert.rejects(db.updateTable("member").set({ organizationId: "org-b" })
        .where("id", "=", "org-a-reviewer").execute(), /foreign key/);
    });
    await t.test("status and reviewer removals emit filter-exit tombstones", async () => {
      const initial = await api.list(reviewer, new URLSearchParams({ role: "reviewer", status: "open" }));
      assert.ok(initial.items.some((item) => item.id === reviewId && !item.removed));
      await api.patch(orgAdmin, reviewId, { status: "closed" });
      const closed = await api.list(reviewer, new URLSearchParams({ role: "reviewer", status: "open", after: initial.nextCursor }));
      assert.ok(closed.items.some((item) => item.id === reviewId && item.removed));
      await api.patch(owner, reviewId, { status: "open" });
      const reopened = await api.list(reviewer, new URLSearchParams({ after: closed.nextCursor }));
      assert.ok(reopened.items.some((item) => item.id === reviewId && !item.removed));
      await api.patch(owner, reviewId, { removeReviewerUserIds: [reviewer.id] });
      const removed = await api.list(reviewer, new URLSearchParams({ after: reopened.nextCursor }));
      assert.ok(removed.items.some((item) => item.id === reviewId && item.removed));
      await assert.rejects(api.list(outsider, new URLSearchParams({ after: removed.nextCursor })), ReviewError);
      await assert.rejects(api.list(reviewer, new URLSearchParams({ role: "all", after: removed.nextCursor })), ReviewError);
      const cursor = JSON.parse(Buffer.from(removed.nextCursor, "base64url").toString("utf8"));
      for (const after of ["9223372036854775808", "99999999999999999999999999999999", 1]) {
        await assert.rejects(api.list(reviewer, new URLSearchParams({
          after: Buffer.from(JSON.stringify({ ...cursor, after })).toString("base64url"),
        })), (e: unknown) => e instanceof ReviewError && e.status === 400);
      }
      await api.patch(owner, reviewId, { addReviewerUserIds: [reviewer.id] });
      await db.deleteFrom("member").where("id", "=", "org-a-reviewer").execute();
      assert.equal((await db.selectFrom("reviewParticipant").select("userId").where("reviewId", "=", reviewId).execute()).length, 0);
      await assert.rejects(api.get(reviewer, reviewId), (e: unknown) => e instanceof ReviewError && e.status === 404);
    });
    await t.test("expired pending attempts renew without duplicate revisions", async () => {
      const pending = await api.push(owner, { organizationId: "org-a", manifest: {
        ...manifest(" pending"), reports: [{ ...manifest().reports[0], blobs: { report: { hash: "f".repeat(64), bytes: bytes.length } } }],
      } });
      await db.updateTable("reviewRevision").set({ expiresAt: new Date(0) }).where("id", "=", pending.body.revision.id).execute();
      await assert.rejects(api.complete(owner, reviewId, pending.body.revision.number), (e: unknown) => e instanceof ReviewError && e.status === 410);
      const retry = await api.push(owner, { organizationId: "org-a", manifest: {
        ...manifest(" pending"), reports: [{ ...manifest().reports[0], blobs: { report: { hash: "f".repeat(64), bytes: bytes.length } } }],
      } });
      assert.equal(retry.body.revision.id, pending.body.revision.id);
    });
    await t.test("former author cannot upload or complete; reports survive account deletion", async () => {
      await db.deleteFrom("member").where("id", "=", "org-a-author").execute();
      await assert.rejects(api.complete(owner, reviewId, 1), (e: unknown) => e instanceof ReviewError && e.status === 404);
      await assert.rejects(api.push(owner, { organizationId: "org-a", manifest: manifest() }), (e: unknown) => e instanceof ReviewError && e.status === 404);
      await assert.rejects(api.get(owner, reviewId), (e: unknown) => e instanceof ReviewError && e.status === 404);
      await db.deleteFrom("user").where("id", "=", owner.id).execute();
      assert.equal((await db.selectFrom("review").select("authorId").where("id", "=", reviewId).executeTakeFirstOrThrow()).authorId, null);
      const report = await db.selectFrom("reviewReport").selectAll().where("revisionId", "=", revisionId).executeTakeFirstOrThrow();
      assert.equal(report.ownerId, null);
      assert.equal(report.ownerName, owner.name);
    });
    await t.test("published content has no automatic retention; deleted organizations enqueue private paths", async () => {
      await db.updateTable("review").set({ updatedAt: new Date(0) }).where("id", "=", reviewId).execute();
      await collectReviews(db, storage);
      assert.ok(await db.selectFrom("review").select("id").where("id", "=", reviewId).executeTakeFirst());
      await db.deleteFrom("organization").where("id", "=", "org-a").execute();
      assert.equal((await db.selectFrom("review").select("id").where("id", "=", reviewId).execute()).length, 0);
      const jobs = await db.selectFrom("reviewGc").selectAll().execute();
      assert.ok(jobs.some((job) => job.storagePath === minted[0]));
      await db.updateTable("reviewGc").set({ notBefore: new Date(0) }).execute();
      failDelete = true;
      await assert.rejects(collectReviews(db, storage), ReviewStorageError);
      assert.ok((await db.selectFrom("reviewGc").select("storagePath").execute()).length > 0);
      failDelete = false;
      await db.updateTable("reviewGc").set({ notBefore: new Date(0) }).execute();
      await Promise.all([collectReviews(db, storage), collectReviews(db, storage)]);
      assert.equal(objects.has(minted[0]), false);
    });
    await t.test("merged reviews require explicit new cycles and explicit deletion emits tombstones", async () => {
      const existing = await db.selectFrom("review").select("id").where("organizationId", "=", "org-b").executeTakeFirstOrThrow();
      await api.patch(outsider, existing.id, { status: "merged" });
      await assert.rejects(api.push(outsider, { organizationId: "org-b", manifest: manifest() }),
        (e: unknown) => e instanceof ReviewError && e.code === "review_merged");
      await assert.rejects(api.complete(outsider, existing.id, 1),
        (e: unknown) => e instanceof ReviewError && e.code === "review_merged");
      const newCycle = await api.push(outsider, { organizationId: "org-b", cycle: randomUUID(), manifest: manifest() });
      assert.notEqual(newCycle.body.review.id, existing.id);
      const upload = await db.selectFrom("reviewUpload").select("storagePath").where("revisionId", "=", newCycle.body.revision.id).executeTakeFirstOrThrow();
      objects.set(upload.storagePath, bytes);
      await api.complete(outsider, newCycle.body.review.id, 1);
      const initial = await api.list(outsider, new URLSearchParams({ organizationId: "org-b", role: "author", status: "all", limit: "100" }));
      await api.remove(outsider, newCycle.body.review.id);
      const deleted = await api.list(outsider, new URLSearchParams({
        organizationId: "org-b", role: "author", status: "all", limit: "100", after: initial.nextCursor,
      }));
      assert.ok(deleted.items.some((item) => item.id === newCycle.body.review.id && item.removed));
    });
    await t.test("commit-ordered clock blocks later publication until earlier event commits", async () => {
      let release!: () => void, locked!: () => void;
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      const lockedPromise = new Promise<void>((resolve) => { locked = resolve; });
      const first = db.transaction().execute(async (tx) => {
        await sql`UPDATE "reviewClock" SET value=value+1 WHERE id`.execute(tx);
        locked();
        await releasePromise;
      });
      await lockedPromise;
      let secondCompleted = false;
      const second = api.push(outsider, { organizationId: "org-b", cycle: randomUUID(), manifest: manifest(" concurrent") })
        .then(() => { secondCompleted = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(secondCompleted, false);
      release(); await first; await second;
    });
  } finally {
    await db.destroy();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
