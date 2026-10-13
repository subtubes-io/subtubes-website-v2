import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProfileLinks, parseProfileLinks } from "../lib/profile-links";

test("normalizes matching HTTPS links and removes tracking data", () => {
  assert.deepEqual(parseProfileLinks({
    x: " https://x.com/example?ref=profile#about ",
    linkedin: "https://www.linkedin.com/in/example",
    github: "https://github.com/example",
    huggingface: "https://huggingface.co/example",
  }), {
    x: "https://x.com/example",
    linkedin: "https://www.linkedin.com/in/example",
    github: "https://github.com/example",
    huggingface: "https://huggingface.co/example",
  });
});

test("blank links remove values and unsafe or mismatched links are rejected", () => {
  assert.deepEqual(parseProfileLinks({ x: "", linkedin: " ", github: null, huggingface: "" }), emptyProfileLinks);
  for (const github of [
    "javascript:alert(1)", "http://github.com/example", "https://github.com.evil.test/example",
    "https://evil.test/github.com", "https://user:pass@github.com/example",
    "https://github.com:8443/example", "https://github.com/", "github.com/example",
    "https://github.com/" + "a".repeat(500),
  ]) {
    assert.throws(() => parseProfileLinks({ ...emptyProfileLinks, github }));
  }
  assert.throws(() => parseProfileLinks({}));
  assert.throws(() => parseProfileLinks(null));
});
