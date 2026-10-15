import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import sharp from "sharp";

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
    assert.equal(limits.maxBlobBytes, 2 * 1024 * 1024);

    // B. Blobs flow
    const imageBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "purple" } }).png().toBuffer();
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
    const inlineDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        document: {
          schemaVersion: 1,
          revision: 1,
          name: "Test Design",
          kind: "swimlane",
          content: { img: "data:image/png;base64,bad" },
          refs: { blobs: [] },
        },
      }),
    });
    assert.equal(inlineDesignRes.status, 422);
    const inlineDesignData = await inlineDesignRes.json();
    assert.equal(inlineDesignData.error.code, "inline_media");

    const designBody = (revision: number, name: string, nodes: unknown[]) => JSON.stringify({
      document: {
        schemaVersion: 1, revision, name, kind: "swimlane",
        content: { name, kind: "swimlane", nodes }, refs: { blobs: [imageHash] },
      },
    });
    const createDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: designBody(1, "Test Swimlane", []),
    });
    assert.equal(createDesignRes.status, 201);
    const createdDesign = await createDesignRes.json();
    assert.equal(createdDesign.created, true);
    assert.equal(createdDesign.designId, designId);
    assert.match(createdDesign.contentHash, /^sha256:[a-f0-9]{64}$/);

    // A second push replaces the one current copy: last write wins, with no version or generation to track.
    const replaceDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: designBody(2, "Test Swimlane Updated", [1]),
    });
    assert.equal(replaceDesignRes.status, 200);
    const replacedDesign = await replaceDesignRes.json();
    assert.equal(replacedDesign.created, false);
    assert.notEqual(replacedDesign.contentHash, createdDesign.contentHash);
    assert.equal(Object.hasOwn(replacedDesign, "headGeneration"), false);
    assert.equal(Object.hasOwn(replacedDesign, "outcome"), false);

    const readDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}`, { headers: authHeaders });
    assert.equal(readDesignRes.status, 200);
    const readDesign = await readDesignRes.json();
    assert.equal(readDesign.document.name, "Test Swimlane Updated");
    assert.equal(readDesign.document.revision, 2);
    assert.equal(readDesign.contentHash, replacedDesign.contentHash);

    const cloneDesignRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs/${designId}/clone`, { method: "POST", headers: authHeaders });
    assert.equal(cloneDesignRes.status, 201);
    const clonedDesign = await cloneDesignRes.json();
    assert.notEqual(clonedDesign.designId, designId);
    assert.equal(clonedDesign.name, "Copy of Test Swimlane Updated");
    const listDesignsRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/designs`, { headers: authHeaders });
    const listedDesigns = (await listDesignsRes.json()).designs as { id: string; name: string }[];
    assert.deepEqual(listedDesigns.map((item) => item.name).sort(), ["Copy of Test Swimlane Updated", "Test Swimlane Updated"]);
    await pool.query('DELETE FROM "design" WHERE "id" = $1', [clonedDesign.designId]);

    // D. The retired history endpoints are gone.
    for (const path of [
      `designs/${designId}/versions`, `designs/${designId}/preferred`,
      `reports/${reportId}/snapshots/1`, `reports/${reportId}/status`,
    ]) {
      const gone = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/${path}`, { headers: authHeaders });
      assert.equal(gone.status, 404, `${path} should no longer exist`);
    }

    // E. Report head flow
    // PUT /reports/{reportId} with missing blob -> 422 missing_blobs
    const missingBlobReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
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
      headers: { ...authHeaders, "Content-Type": "application/json" },
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

    // PUT /reports/{reportId} replaces the one current copy, with no If-Match to supply.
    const updateReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
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

    // A push from a computer that is behind simply wins: the last write is the current copy.
    const staleReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        revision: 1,
        contentHash: "sha256:report-head-hash-1b",
        project: { name: "Test Project" },
        report: { title: "Head from a slower computer" },
        refs: { blobs: [imageHash], designs: [] },
      }),
    });
    assert.equal(staleReportRes.status, 200);
    const readReport = await (await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}`, { headers: authHeaders })).json();
    assert.equal(readReport.report.title, "Head from a slower computer");
    assert.equal(readReport.revision, 1);

    // F. Cloning makes an independent report with its own ID.
    const cloneReportRes = await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${reportId}/clone`, { method: "POST", headers: authHeaders });
    assert.equal(cloneReportRes.status, 201);
    const clonedReport = await cloneReportRes.json();
    assert.notEqual(clonedReport.reportId, reportId);
    assert.equal(clonedReport.name, "Copy of Head from a slower computer");
    assert.equal(clonedReport.revision, 1);
    const readClone = await (await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports/${clonedReport.reportId}`, { headers: authHeaders })).json();
    assert.equal(readClone.report.title, "Copy of Head from a slower computer");
    const listed = (await (await fetch(`${baseUrl}/api/v1/organizations/${orgId}/reports`, { headers: authHeaders })).json()).reports as { id: string; snapshots?: unknown }[];
    assert.equal(listed.length, 2);
    assert.ok(listed.every((item) => !("snapshots" in item)), "the list no longer reports snapshots");
    await pool.query('DELETE FROM "report" WHERE "id" = $1', [clonedReport.reportId]);
  } finally {
    await pool.query('DELETE FROM "report" WHERE "id" = $1', [reportId]);
    await pool.query('DELETE FROM "design" WHERE "id" = $1', [designId]);
    await pool.query('DELETE FROM "blob" WHERE "organizationId" = $1', [orgId]);
    await pool.query('DELETE FROM "organization" WHERE "id" = $1', [orgId]);
    await pool.query('DELETE FROM "user" WHERE "email" = $1', [email]);
    await pool.end();
  }
});
