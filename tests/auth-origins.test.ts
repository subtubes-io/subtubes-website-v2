import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthOrigins } from "../lib/auth-origins";

test("trusts the canonical origin and explicitly listed aliases only", () => {
  assert.deepEqual(
    getAuthOrigins("https://subtubes.com", " https://www.subtubes.com,https://subtubes-remote.vercel.app,https://subtubes.com, "),
    ["https://subtubes.com", "https://www.subtubes.com", "https://subtubes-remote.vercel.app"],
  );
});

test("preserves local auth and handles absent origin configuration", () => {
  assert.deepEqual(getAuthOrigins("http://localhost:3000", ""), ["http://localhost:3000"]);
  assert.deepEqual(getAuthOrigins("", ""), []);
});

test("rejects wildcard, non-HTTP, and non-origin values", () => {
  for (const origin of [
    "https://*.subtubes.com", "https://subtubes.com/path",
    "https://subtubes.com/", "https://subtubes.com?query=true",
    "https://user:password@subtubes.com", "javascript:alert(1)", "not-a-url",
  ]) {
    assert.throws(() => getAuthOrigins("https://subtubes.com", origin));
  }
  assert.equal(getAuthOrigins("https://subtubes.com", "").includes("https://subtubes.com.evil.test"), false);
});
