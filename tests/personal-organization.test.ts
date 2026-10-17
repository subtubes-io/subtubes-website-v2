import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

test("personal organization lifecycle and constraints", async () => {
  const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
  const email = `personal-org-${randomUUID()}@example.test`;
  const password = "Password123!";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let userId: string | undefined;
  try {
    const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ name: "Personal Org Tester", email, password }),
    });
    assert.equal(signup.status, 200);
    userId = (await signup.json()).user.id;
    const headers = {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Cookie: signup.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "),
    };
    const result = await pool.query(
      `SELECT o.id, o.metadata FROM organization o
       INNER JOIN member m ON m."organizationId" = o.id WHERE m."userId" = $1`,
      [userId],
    );
    assert.equal(result.rows.length, 1);
    const org = result.rows[0];
    assert.deepEqual(JSON.parse(org.metadata), { isPersonal: true, personalUserId: userId });
    for (const [path, body, message] of [
      ["invite-member", { organizationId: org.id, email: "invite@example.test", role: "member" }, /Cannot invite/],
      ["leave", { organizationId: org.id }, /cannot leave/],
      ["delete", { organizationId: org.id }, /Personal organizations cannot be deleted/],
    ] as const) {
      const response = await fetch(`${baseUrl}/api/auth/organization/${path}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.match(await response.text(), message);
    }
    const deleted = await fetch(`${baseUrl}/api/auth/delete-user`, {
      method: "POST", headers, body: JSON.stringify({ password }),
    });
    assert.equal(deleted.status, 200);
    assert.equal((await pool.query("SELECT id FROM organization WHERE id = $1", [org.id])).rowCount, 0);
  } finally {
    if (userId) {
      await pool.query(
        `DELETE FROM organization WHERE metadata::jsonb ->> 'personalUserId' = $1`,
        [userId],
      );
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    }
    await pool.end();
  }
});
