import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

test("GET /api/v1/me rejects unauthenticated requests with 401", async () => {
  const { GET } = await import("../app/api/v1/me/route");
  const response = await GET(new Request("http://localhost:3000/api/v1/me"));
  assert.equal(response.status, 401);
  const json = await response.json();
  assert.equal(json.error, "unauthorized");
  assert.equal(json.message, "Authentication required.");
});

test("OPTIONS /api/v1/me returns CORS preflight headers", async () => {
  const { OPTIONS } = await import("../app/api/v1/me/route");
  const response = await OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.ok(response.headers.get("access-control-allow-methods")?.includes("GET"));
  assert.ok(response.headers.get("access-control-allow-headers")?.includes("Authorization"));
});

test("desktop device flow, bearer session, and GET /api/v1/me integration", async () => {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
  let serverReady = false;
  try {
    const ping = await fetch(`${baseUrl}/api/auth/get-session`);
    serverReady = ping.status === 200 || ping.status === 401;
  } catch {
    serverReady = false;
  }

  if (!serverReady) {
    console.log("Local server not running on", baseUrl, "- skipping live network test");
    return;
  }

  const email = `desktop-test-${randomUUID()}@example.test`;
  const password = "Password123!";
  const name = "Desktop Integration Tester";

  // 1. Sign up user
  const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl },
    body: JSON.stringify({ name, email, password }),
  });
  assert.equal(signupRes.status, 200);
  const cookies = signupRes.headers.getSetCookie();
  const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

  // Create organization
  const orgSlug = `test-org-${randomUUID().slice(0, 8)}`;
  const orgRes = await fetch(`${baseUrl}/api/auth/organization/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": baseUrl, "Cookie": cookieHeader },
    body: JSON.stringify({ name: "Test Desktop Org", slug: orgSlug }),
  });
  assert.equal(orgRes.status, 200);
  const orgData = await orgRes.json();

  try {
    // 2. Request device code
    const codeRes = await fetch(`${baseUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": baseUrl },
      body: JSON.stringify({ client_id: "subtubes-ire-desktop" }),
    });
    assert.equal(codeRes.status, 200);
    const codeData = await codeRes.json();
    assert.ok(codeData.device_code);
    assert.ok(codeData.user_code);
    assert.ok(codeData.verification_uri);
    assert.ok(codeData.verification_uri_complete);

    // 3. Claim and approve device code
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

    // 4. Poll for access token
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
    assert.ok(tokenData.access_token);
    assert.equal(tokenData.token_type, "Bearer");

    // 5. Test GET /api/v1/me with Bearer token
    const meRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { "Authorization": `Bearer ${tokenData.access_token}` },
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.headers.get("cache-control"), "no-store");
    const meData = await meRes.json();
    assert.equal(meData.user.name, name);
    assert.equal(meData.user.email, email);
    assert.ok(Array.isArray(meData.organizations));
    assert.equal(meData.organizations.length, 2);
    const createdOrg = meData.organizations.find((o: { id: string }) => o.id === orgData.id);
    assert.ok(createdOrg);
    assert.equal(createdOrg.name, "Test Desktop Org");
    assert.equal(createdOrg.slug, orgSlug);
    assert.equal(createdOrg.role, "owner");

    // 6. Sign out session
    const signOutRes = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(signOutRes.status, 200);

    // 7. Subsequent GET /api/v1/me with revoked token returns 401
    const revokedRes = await fetch(`${baseUrl}/api/v1/me`, {
      headers: { "Authorization": `Bearer ${tokenData.access_token}` },
    });
    assert.equal(revokedRes.status, 401);
  } finally {
    if (process.env.DATABASE_URL) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('DELETE FROM "organization" WHERE "id" = $1', [orgData.id]);
      await pool.query('DELETE FROM "user" WHERE "email" = $1', [email]);
      await pool.end();
    }
  }
});
