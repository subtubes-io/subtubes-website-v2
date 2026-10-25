import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContactMessage } from "../lib/contact";

test("trims a valid message and lowercases the email", () => {
  assert.deepEqual(
    parseContactMessage({ name: " Alex ", email: " Alex@Example.com ", message: " Hello " }),
    { name: "Alex", email: "alex@example.com", message: "Hello" },
  );
});

test("rejects missing, blank, oversized or malformed fields", () => {
  const ok = { name: "Alex", email: "alex@example.com", message: "Hi" };
  for (const bad of [null, "text", {}, { ...ok, name: " " }, { ...ok, message: "" }, { ...ok, email: "nope" },
    { ...ok, name: "a".repeat(81) }, { ...ok, message: "a".repeat(5001) }, { ...ok, message: 5 }]) {
    assert.throws(() => parseContactMessage(bad));
  }
});
