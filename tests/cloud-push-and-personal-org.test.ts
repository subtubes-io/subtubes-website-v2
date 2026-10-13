import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

test("personal organization lifecycle and constraints", async () => {
  let serverReady = false;
  try {
    const ping = await fetch(`${baseUrl}/api/auth/get-session`);
    serverReady = ping.status === 200 || ping.status === 401;
  } catch {
    serverReady = false;
  }
  if (!serverReady) {
    console.log("Local server not running on", baseUrl, "- skipping test");
    return;
  }

  const email = `personal-org-${randomUUID()}@example.test`;
  const password = "Password123!";
  const name = "Personal Org Tester";

  // 1. Sign up user
  const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl },
    body: JSON.stringify({ name, email, password }),
  });
  assert.equal(signupRes.status, 200);
  const signupData = await signupRes.json();
  const userId = signupData.user.id;
  const cookies = signupRes.headers.getSetCookie();
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let personalOrgId = "";

  try {
    // 2. Verify personal organization was automatically created
    const orgsRes = await pool.query(
      `SELECT o."id", o."name", o."slug", o."metadata"
       FROM "organization" o
       INNER JOIN "member" m ON m."organizationId" = o."id"
       WHERE m."userId" = $1`,
      [userId]
    );

    assert.equal(orgsRes.rows.length, 1, "User should have exactly 1 organization automatically created");
    const personalOrg = orgsRes.rows[0];
    personalOrgId = personalOrg.id;
    const metadata = JSON.parse(personalOrg.metadata);
    assert.equal(metadata.isPersonal, true);
    assert.equal(metadata.personalUserId, userId);

    // 3. User cannot invite anyone to the personal organization
    const inviteRes = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
      body: JSON.stringify({
        organizationId: personalOrgId,
        email: "invited-user@example.test",
        role: "member",
      }),
    });
    assert.equal(inviteRes.status, 400);
    const inviteJson = await inviteRes.json();
    assert.ok(inviteJson.message?.includes("Cannot invite members to a personal organization") || inviteJson.error?.includes("Cannot invite"));

    // 4. User cannot leave their personal organization
    const leaveRes = await fetch(`${baseUrl}/api/auth/organization/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
      body: JSON.stringify({
        organizationId: personalOrgId,
      }),
    });
    assert.equal(leaveRes.status, 400);
    const leaveJson = await leaveRes.json();
    assert.ok(leaveJson.message?.includes("cannot leave") || leaveJson.error?.includes("cannot leave"));

    // 5. User cannot delete the personal organization directly
    const deleteOrgRes = await fetch(`${baseUrl}/api/auth/organization/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
      body: JSON.stringify({
        organizationId: personalOrgId,
      }),
    });
    assert.equal(deleteOrgRes.status, 400);
    const deleteOrgJson = await deleteOrgRes.json();
    assert.ok(deleteOrgJson.message?.includes("Personal organizations cannot be deleted directly") || deleteOrgJson.error?.includes("Personal organizations"));

    // 6. Delete user account -> personal org is deleted
    const deleteUserRes = await fetch(`${baseUrl}/api/auth/delete-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
      body: JSON.stringify({ password }),
    });
    assert.equal(deleteUserRes.status, 200);

    // Verify personal org is now deleted from DB
    const orgCheck = await pool.query(`SELECT "id" FROM "organization" WHERE "id" = $1`, [personalOrgId]);
    assert.equal(orgCheck.rows.length, 0, "Personal organization must be deleted when user account is deleted");
  } finally {
    if (personalOrgId) {
      await pool.query('DELETE FROM "organization" WHERE "id" = $1', [personalOrgId]);
    }
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [userId]);
    await pool.end();
  }
});

test("cloud push API contract (/api/v1/organizations/{orgId})", async () => {
  let serverReady = false;
  try {
    const ping = await fetch(`${baseUrl}/api/auth/get-session`);
    serverReady = ping.status === 200 || ping.status === 401;
  } catch {
    serverReady = false;
  }
  if (!serverReady) {
    console.log("Local server not running on", baseUrl, "- skipping test");
    return;
  }

  const email = `cloud-push-${randomUUID()}@example.test`;
  const password = "Password123!";
  const name = "Cloud Push Tester";

  // 1. Sign up user
  const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl },
    body: JSON.stringify({ name, email, password }),
  });
  assert.equal(signupRes.status, 200);
  const cookies = signupRes.headers.getSetCookie();
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

  // 2. Device flow to get bearer access token
  const codeRes = await fetch(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl },
    body: JSON.stringify({ client_id: "subtubes-ire-desktop" }),
  });
  assert.equal(codeRes.status, 200);
  const codeData = await codeRes.json();

  const verifyRes = await fetch(`${baseUrl}/api/auth/device?user_code=${codeData.user_code}`, {
    headers: { "Cookie": cookieHeader },
  });
  assert.equal(verifyRes.status, 200);

  const approveRes = await fetch(`${baseUrl}/api/auth/device/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
    body: JSON.stringify({ userCode: codeData.user_code }),
  });
  assert.equal(approveRes.status, 200);

  const tokenRes = await fetch(`${baseUrl}/api/auth/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: codeData.device_code,
      client_id: "subtubes-ire-desktop",
    }),
  });
  assert.equal(tokenRes.status, 200);
  const tokenData = await tokenRes.json();
  const bearerToken = tokenData.access_token;
  const authHeaders = {
    "Authorization": ["Bearer", bearerToken].join(" "),
    "Origin": baseUrl,
  };

  // 3. Find the user's personal organization ID via /api/v1/me
  const meRes = await fetch(`${baseUrl}/api/v1/me`, { headers: authHeaders });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.ok(meData.organizations.length >= 1);
  const orgId = meData.organizations[0].id;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const reportId = randomUUID();
  const designId = randomUUID();

  try {
    // A. GET /limits
    const limitsRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/limits`, {
      headers: authHeaders,
    });
    assert.equal(limitsRes.status, 200);
    const limits = await limitsRes.json();
    assert.deepEqual(limits.supportedSchemaVersions, [2]);
    assert.equal(limits.maxReportDocumentBytes, 10 * 1024 * 1024);
    assert.equal(limits.maxBlobBytes, 5 * 1024 * 1024);

    // B. Blobs flow
    const imageBytes = Buffer.from("fake-png-image-content-for-test");
    const imageHash = createHash("sha256").update(imageBytes).digest("hex");

    // POST /blobs/missing before upload -> reported missing
    const missingPre = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/blobs/missing`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: [imageHash] }),
    });
    assert.equal(missingPre.status, 200);
    const missingPreData = await missingPre.json();
    assert.deepEqual(missingPreData.missing, [imageHash]);

    // PUT /blobs/{hash} with wrong hash -> 422 hash_mismatch
    const mismatchRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/blobs/0000000000000000000000000000000000000000000000000000000000000000`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "image/png" },
      body: imageBytes,
    });
    assert.equal(mismatchRes.status, 422);
    const mismatchData = await mismatchRes.json();
    assert.equal(mismatchData.error.code, "hash_mismatch");

    // PUT /blobs/{hash} with correct hash -> 200 success
    const blobUploadRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/blobs/${imageHash}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "image/png" },
      body: imageBytes,
    });
    assert.equal(blobUploadRes.status, 200);

    // POST /blobs/missing after upload -> no longer missing
    const missingPost = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/blobs/missing`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: [imageHash] }),
    });
    assert.equal(missingPost.status, 200);
    const missingPostData = await missingPost.json();
    assert.deepEqual(missingPostData.missing, []);

    // C. Designs flow
    // PUT /designs/{designId} with inline media -> 422 inline_media
    const inlineDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        name: "Test Design",
        kind: "swimlane",
        content: { img: "data:image/png;base64,bad" },
        refs: { blobs: [] },
      }),
    });
    assert.equal(inlineDesignRes.status, 422);
    const inlineDesignData = await inlineDesignRes.json();
    assert.equal(inlineDesignData.error.code, "inline_media");

    // PUT /designs/{designId} create valid design -> 200
    const createDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        name: "Test Swimlane",
        kind: "swimlane",
        content: { nodes: [] },
        refs: { blobs: [imageHash] },
      }),
    });
    assert.equal(createDesignRes.status, 200);

    // PUT /designs/{designId} without If-Match when existing -> 409 revision_conflict
    const conflictDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        revision: 2,
        name: "Test Swimlane Updated",
        kind: "swimlane",
        content: { nodes: [1] },
        refs: { blobs: [imageHash] },
      }),
    });
    assert.equal(conflictDesignRes.status, 409);
    const conflictDesignData = await conflictDesignRes.json();
    assert.equal(conflictDesignData.error.code, "revision_conflict");
    assert.equal(conflictDesignData.error.details.currentRevision, 1);

    // PUT /designs/{designId} with correct If-Match: 1 -> 200
    const updateDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-Match": "1" },
      body: JSON.stringify({
        schemaVersion: 1,
        revision: 2,
        name: "Test Swimlane Updated",
        kind: "swimlane",
        content: { nodes: [1] },
        refs: { blobs: [imageHash] },
      }),
    });
    assert.equal(updateDesignRes.status, 200);

    // D. Snapshots flow
    // GET /reports/{reportId}/status before report created -> 404
    const statusPreRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/status`, {
      headers: authHeaders,
    });
    assert.equal(statusPreRes.status, 404);

    // PUT /reports/{reportId}/snapshots/1 with unsupported schemaVersion -> 422
    const unsuppSnapRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/snapshots/1`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 99,
        number: 1,
        contentHash: "sha256:fakehash",
        report: { title: "Snap" },
      }),
    });
    assert.equal(unsuppSnapRes.status, 422);
    const unsuppSnapData = await unsuppSnapRes.json();
    assert.equal(unsuppSnapData.error.code, "unsupported_schema_version");

    // PUT /reports/{reportId}/snapshots/1 valid -> 200
    const snapRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/snapshots/1`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        number: 1,
        takenAt: "2026-10-12T18:00:00Z",
        contentHash: "sha256:first-snapshot-hash",
        report: { title: "First Snapshot" },
        refs: { blobs: [imageHash], designs: [] },
      }),
    });
    assert.equal(snapRes.status, 200);

    // Idempotent re-put of same snapshot hash -> 200
    const snapReRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/snapshots/1`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        number: 1,
        takenAt: "2026-10-12T18:00:00Z",
        contentHash: "sha256:first-snapshot-hash",
        report: { title: "First Snapshot" },
        refs: { blobs: [imageHash], designs: [] },
      }),
    });
    assert.equal(snapReRes.status, 200);

    // Overwriting snapshot with different contentHash -> 409 snapshot_immutable
    const snapConflictRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/snapshots/1`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        number: 1,
        takenAt: "2026-10-12T18:00:00Z",
        contentHash: "sha256:different-snapshot-hash",
        report: { title: "Mutated Snapshot" },
        refs: { blobs: [imageHash], designs: [] },
      }),
    });
    assert.equal(snapConflictRes.status, 409);
    const snapConflictData = await snapConflictRes.json();
    assert.equal(snapConflictData.error.code, "snapshot_immutable");

    // E. Report head flow
    // PUT /reports/{reportId} with missing blob -> 422 missing_blobs
    const missingBlobReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        contentHash: "sha256:report-head-hash-1",
        project: { name: "Test Project" },
        report: { title: "Head" },
        refs: {
          blobs: ["1111111111111111111111111111111111111111111111111111111111111111"],
          designs: [],
        },
      }),
    });
    assert.equal(missingBlobReportRes.status, 422);
    const missingBlobReportData = await missingBlobReportRes.json();
    assert.equal(missingBlobReportData.error.code, "missing_blobs");

    // PUT /reports/{reportId} valid create -> 200
    const createReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-None-Match": "*" },
      body: JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        contentHash: "sha256:report-head-hash-1",
        project: { name: "Test Project" },
        report: { title: "Head" },
        refs: {
          blobs: [imageHash],
          designs: [{ id: designId, revision: 2 }],
        },
      }),
    });
    assert.equal(createReportRes.status, 200);

    // PUT /reports/{reportId} update with If-Match: 1 -> 200
    const updateReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json", "If-Match": "1" },
      body: JSON.stringify({
        schemaVersion: 2,
        revision: 2,
        contentHash: "sha256:report-head-hash-2",
        project: { name: "Test Project" },
        report: { title: "Head Rev 2" },
        refs: {
          blobs: [imageHash],
          designs: [{ id: designId, revision: 2 }],
        },
      }),
    });
    assert.equal(updateReportRes.status, 200);

    // F. GET /reports/{reportId}/status
    const statusPostRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/status`, {
      headers: authHeaders,
    });
    assert.equal(statusPostRes.status, 200);
    const statusData = await statusPostRes.json();
    assert.equal(statusData.revision, 2);
    assert.equal(statusData.contentHash, "sha256:report-head-hash-2");
    assert.deepEqual(statusData.snapshots, [1]);
  } finally {
    await pool.query('DELETE FROM "reportSnapshot" WHERE "reportId" = $1', [reportId]);
    await pool.query('DELETE FROM "report" WHERE "id" = $1', [reportId]);
    await pool.query('DELETE FROM "design" WHERE "id" = $1', [designId]);
    await pool.query('DELETE FROM "blob" WHERE "organizationId" = $1', [orgId]);
    await pool.query('DELETE FROM "organization" WHERE "id" = $1', [orgId]);
    await pool.query('DELETE FROM "user" WHERE "email" = $1', [email]);
    await pool.end();
  }
});
