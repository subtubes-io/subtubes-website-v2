import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

test("live Next routes enforce Bearer/member boundaries and expose report organization/owner", {
  skip: !process.env.REVIEWS_TEST_BASE_URL && "Set REVIEWS_TEST_BASE_URL with a disposable local app/database.",
}, async () => {
  const base = process.env.REVIEWS_TEST_BASE_URL!;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const userIds: string[] = [];
  const orgIds: string[] = [];
  const hash = createHash("sha256").update("seeded verified metadata").digest("hex");
  let storagePath: string | undefined;
  const signup = async () => {
    const result = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Review API fixture", email: `reviews-${randomUUID()}@example.test`, password: "Password123!" }),
    });
    assert.equal(result.status, 200);
    const data = await result.json();
    userIds.push(data.user.id);
    assert.equal(typeof data.token, "string");
    return { id: String(data.user.id), token: String(data.token),
      cookie: result.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") };
  };
  try {
    const author = await signup();
    const outsider = { id: randomUUID(), token: randomUUID() };
    userIds.push(outsider.id);
    await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [outsider.id, "Outside fixture", `reviews-${outsider.id}@example.test`]);
    await pool.query(`INSERT INTO session(id,token,"userId","expiresAt","updatedAt")
      VALUES($1,$2,$3,now()+interval '1 day',now())`, [randomUUID(), outsider.token, outsider.id]);
    const org = await pool.query('SELECT "organizationId" AS id FROM member WHERE "userId"=$1', [author.id]);
    const orgId: string = org.rows[0].id;
    const request = (path: string, method = "GET", body?: unknown, token = author.token) => fetch(`${base}/api/v1/reviews${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual",
    });
    for (const path of ["", "/limits", `/usage?organizationId=${orgId}`, "/missing", "/missing/revisions/1", `/missing/blobs/${hash}`]) {
      const denied = await fetch(`${base}/api/v1/reviews${path}`, { headers: { cookie: author.cookie } });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "no-store");
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
    }
    const invalid = await fetch(`${base}/api/v1/reviews/limits`, {
      headers: { authorization: "Bearer invalid", cookie: author.cookie },
    });
    assert.equal(invalid.status, 401);
    assert.equal((await request("/limits")).status, 200);
    assert.equal((await request(`/usage?organizationId=${orgId}`, "GET", undefined, outsider.token)).status, 404);
    storagePath = `reviews/${orgId}/uploads/${randomUUID()}/${hash}`;
    // Seed only verified metadata; this route test never contacts a real Blob store.
    await pool.query(`INSERT INTO "reviewBlob"("organizationId",hash,"byteSize","contentType","storagePath","verifiedAt")
      VALUES($1,$2,24,'application/gzip',$3,now())`, [orgId, hash, storagePath]);
    const manifest = {
      manifestSchemaVersion: 1, client: { app: "route-test", version: "1" },
      repo: { key: "a".repeat(40), remoteUrl: "https://github.com/example/repository" },
      review: { title: "Route fixture", sourceBranch: "feature", targetBranch: "main" },
      revision: { baseSha: "a".repeat(40), headSha: "b".repeat(40), commitCount: 1, fileCount: 1 },
      code: { transport: "remote" },
      reports: [{ clientId: "fixture", kind: "commit", commit: "b".repeat(40), schemaVersion: 1, title: "Fixture",
        featureCount: 0, issueCount: 0, createdAt: "2026-10-17T00:00:00.000Z", blobs: { report: { hash, bytes: 24 } } }],
    };
    const push = await request("/push", "POST", { organizationId: orgId, manifest, reviewerUserIds: [author.id] });
    assert.equal(push.status, 201);
    const pushed = await push.json();
    const reviewId: string = pushed.review.id;
    assert.equal(pushed.revision.state, "complete");
    assert.deepEqual(pushed.missing, []);
    assert.equal((await request("/push", "POST", { organizationId: orgId, manifest })).status, 200);
    assert.equal((await request(`/${reviewId}/revisions/1/complete`, "POST")).status, 200);
    const read = await request(`/${reviewId}/revisions/1`);
    assert.equal(read.status, 200);
    const data = await read.json();
    assert.equal(data.reports[0].organizationId, orgId);
    assert.equal(data.reports[0].ownerId, author.id);
    assert.equal((await request(`/${reviewId}/revisions/not-a-number`)).status, 400);
    assert.equal((await request(`/${reviewId}/blobs/${"f".repeat(64)}`)).status, 404);
    assert.equal((await request(`/${reviewId}`, "GET", undefined, outsider.token)).status, 404);
    assert.equal((await request(`/${reviewId}`, "DELETE", undefined, outsider.token)).status, 404);
    assert.equal((await request(`/${reviewId}/seen`, "PUT", { revision: 1 })).status, 200);
    const initial = await (await request(`?organizationId=${orgId}&role=all&status=all`)).json();
    assert.ok(initial.items.some((item: { id: string }) => item.id === reviewId));
    assert.equal((await request(`/${reviewId}`, "PATCH", { title: "Updated" })).status, 200);
    assert.equal((await request(`/${reviewId}`, "DELETE")).status, 202);
    const removed = await (await request(`?organizationId=${orgId}&role=all&status=all&after=${initial.nextCursor}`)).json();
    assert.ok(removed.items.some((item: { id: string; removed: boolean }) => item.id === reviewId && item.removed));
    assert.equal((await request(`/${reviewId}`)).status, 404);
    assert.equal((await fetch(`${base}/api/cron/reviews-gc`)).status, 401);
  } finally {
    for (const userId of userIds) {
      const organizations = await pool.query(`SELECT id FROM organization WHERE metadata::jsonb->>'personalUserId'=$1`, [userId]);
      orgIds.push(...organizations.rows.map((org: { id: string }) => org.id));
      await pool.query(`DELETE FROM organization WHERE metadata::jsonb->>'personalUserId'=$1`, [userId]);
      await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
    }
    if (storagePath) await pool.query('DELETE FROM "reviewGc" WHERE "storagePath"=$1', [storagePath]);
    for (const orgId of orgIds) await pool.query('DELETE FROM "reviewChange" WHERE "organizationId"=$1', [orgId]);
    await pool.end();
  }
});
