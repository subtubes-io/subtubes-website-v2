import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

test("API accepts only explicit Bearer credentials and never falls back to cookies", async () => {
  const { bearerHeaders } = await import("../lib/reviews/http");
  for (const authorization of [undefined, "", "Basic abc", "Bearer ", "Bearer abc def"]) {
    assert.throws(() => bearerHeaders(new Request("http://localhost/api/v1/reviews", {
      headers: { cookie: "better-auth.session_token=browser-session", ...(authorization ? { authorization } : {}) },
    })), /Authentication required/);
  }
  const headers = bearerHeaders(new Request("http://localhost/api/v1/reviews", {
    headers: { cookie: "better-auth.session_token=browser-session", authorization: "Bearer desktop-session" },
  }));
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), "Bearer desktop-session");
});

test("streamed JSON is bounded before parsing and nesting cannot exhaust the parser", async () => {
  const { readJson } = await import("../lib/reviews/http");
  const request = (body: string, type = "application/json") => new Request("http://localhost/api/v1/reviews/push", {
    method: "POST", headers: { "content-type": type }, body,
  });
  assert.deepEqual(await readJson(request('{"organizationId":"example"}')), { organizationId: "example" });
  await assert.rejects(readJson(request("{}", "text/plain")), /application\/json/);
  await assert.rejects(readJson(request("invalid")), /Invalid JSON/);
  await assert.rejects(readJson(request("[".repeat(33) + "0" + "]".repeat(33))), /nesting/);
  await assert.rejects(readJson(request(" ".repeat(589825))), /byte limit/);
});

test("error responses never expose token-bearing provider or database messages", async () => {
  const { failure } = await import("../lib/reviews/http");
  const captured: unknown[][] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    const result = failure(new Error("postgres password or https://private.example/?signature=secret"));
    assert.equal(result.status, 500);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.ok(!JSON.stringify(captured).includes("signature"));
    assert.ok(!(await result.text()).includes("password"));
  } finally { console.error = previous; }
});
