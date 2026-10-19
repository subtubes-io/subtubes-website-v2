import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPOSITORY_KEY_PATTERN, repositoryKey } from "../lib/pull-request-reports/repository-key";

// The same vectors the desktop app runs (its shared/fixtures/repository-key-vectors.json): the two rules must agree.
const vectors: [string, string | null][] = JSON.parse(readFileSync(new URL("./fixtures/repository-key-vectors.json", import.meta.url), "utf8"));

test("works out the same repository key as the desktop app for every vector", () => {
  assert.ok(vectors.length >= 30);
  for (const [remote, key] of vectors) assert.equal(repositoryKey(remote), key, JSON.stringify(remote));
});

test("every key it makes is one the database and the list accept, and no other kind of text is", () => {
  for (const [, key] of vectors) if (key) assert.match(key, REPOSITORY_KEY_PATTERN);
  for (const bad of ["", "github.com", "github.com/acme", "GitHub.com/acme/p", "https://github.com/acme/p", "github.com/acme/p q", "-x.com/a/b"]) {
    assert.doesNotMatch(bad, REPOSITORY_KEY_PATTERN, bad);
  }
});
