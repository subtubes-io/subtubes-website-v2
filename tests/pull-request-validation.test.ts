import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiError } from "../lib/pull-request-reports/errors";
import { sanitizeRemote } from "../lib/pull-request-reports/remote";
import { LIMITS } from "../lib/pull-request-reports/schema";
import { validatePublishBody } from "../lib/pull-request-reports/validate";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture: Json = JSON.parse(readFileSync(new URL("./fixtures/pull-request-report-publish-request.json", import.meta.url), "utf8"));
const fresh = (): Json => structuredClone(fixture);
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

function refusal(body: Uint8Array | unknown): ApiError {
  try {
    validatePublishBody(body instanceof Uint8Array ? body : encode(body));
  } catch (error) {
    assert.ok(error instanceof ApiError, "expected an ApiError");
    return error;
  }
  assert.fail("expected the body to be refused");
}

function invalid(mutate: (request: Json) => void, path: string) {
  const request = fresh();
  mutate(request);
  const error = refusal(request);
  assert.equal(error.code, "invalid-report");
  assert.ok(error.details?.issues?.some((issue) => issue.path === path || issue.path.startsWith(`${path}.`)), `no issue at ${path}: ${JSON.stringify(error.details)}`);
}

test("accepts the document the desktop app publishes, and hashes the bytes it received", () => {
  const body = encode(fixture);
  const result = validatePublishBody(body);
  assert.equal(result.sizeBytes, body.byteLength);
  assert.match(result.bodySha256, /^[0-9a-f]{64}$/);
  assert.equal(result.request.bundle.report.id, fixture.bundle.report.id);
  assert.equal(validatePublishBody(body).bodySha256, result.bodySha256);
});

test("refuses any key that is not in the format, at the top, in the document, and in the design", () => {
  invalid((r) => { r.userId = "u1"; }, "");
  invalid((r) => { r.organizationId = "org"; }, "");
  invalid((r) => { r.bundle.createdBy = "u1"; }, "bundle");
  invalid((r) => { r.bundle.files[0].extra = true; }, "bundle.files.0");
  invalid((r) => { r.bundle.design.diagram.nodes[0].extra = 1; }, "bundle.design.diagram.nodes.0");
  invalid((r) => { r.bundle.design.scenarios[0].extra = 1; }, "bundle.design.scenarios.0");
  invalid((r) => { r.repository.extra = 1; }, "repository");
});

test("refuses a missing or wrongly typed field", () => {
  invalid((r) => { delete r.bundle.report; }, "bundle.report");
  invalid((r) => { delete r.bundle; }, "bundle");
  invalid((r) => { r.bundle.kind = "something-else"; }, "bundle.kind");
  invalid((r) => { r.bundle.exportedAt = "yesterday"; }, "bundle.exportedAt");
  invalid((r) => { r.bundle.exportedAt = "2026-10-18T00:00:00+02:00"; }, "bundle.exportedAt");
  invalid((r) => { r.bundle.report.draftedBy = "robot"; }, "bundle.report.draftedBy");
  invalid((r) => { r.bundle.report.risks[0].severity = "critical"; }, "bundle.report.risks.0.severity");
  invalid((r) => { r.bundle.branch.range.headSha = "ABC"; }, "bundle.branch.range.headSha");
  invalid((r) => { r.bundle.commits = []; }, "bundle.commits");
  invalid((r) => { r.bundle.files[0].status = "renamed"; }, "bundle.files.0.status");
  invalid((r) => { r.bundle.files[0].additions = -1; }, "bundle.files.0.additions");
  invalid((r) => { r.bundle.files[0].additions = 1.5; }, "bundle.files.0.additions");
  invalid((r) => { r.bundle.discussion = [{ role: "system", text: "", comments: [] }]; }, "bundle.discussion.0.role");
  invalid((r) => { r.bundle.discussion = [{ role: "user", text: "", comments: [{ path: "a", lines: { start: 0, end: 1, side: "new" }, excerpt: "", body: "" }] }]; }, "bundle.discussion.0.comments.0.lines.start");
  invalid((r) => { r.repository = { name: "", remote: fixture.repository.remote }; }, "repository.name");
  invalid((r) => { r.repository.remote = null; }, "repository.remote");
  invalid((r) => { delete r.repository; }, "repository");
  invalid((r) => { r.repository.name = "x".repeat(201); }, "repository.name");
});

test("checks the diagram and scenarios the document carries, not just that they are objects", () => {
  invalid((r) => { r.bundle.design.diagram = {}; }, "bundle.design.diagram");
  invalid((r) => { r.bundle.design.diagram.schemaVersion = 2; }, "bundle.design.diagram.schemaVersion");
  invalid((r) => { r.bundle.design.diagram.nodes[0].layer = "cloud"; }, "bundle.design.diagram.nodes.0.layer");
  invalid((r) => { r.bundle.design.diagram.nodes[0].w = 0; }, "bundle.design.diagram.nodes.0.w");
  invalid((r) => { r.bundle.design.diagram.nodes[0].x = "1"; }, "bundle.design.diagram.nodes.0.x");
  invalid((r) => { r.bundle.design.diagram.nodes.push({ ...r.bundle.design.diagram.nodes[0] }); }, "bundle.design.diagram.nodes");
  invalid((r) => { r.bundle.design.diagram.edges[0].to = "no-such-node"; }, "bundle.design.diagram.edges.0.to");
  invalid((r) => { r.bundle.design.scenarios[0].start = "no-such-step"; }, "bundle.design.scenarios.0.start");
  invalid((r) => { r.bundle.design.scenarios = "none"; }, "bundle.design.scenarios");
  // A scenario can outlive a node it was written for; the app's own format allows it, so a report with one is not refused.
  const orphaned = fresh();
  orphaned.bundle.design.diagram.nodes = [];
  orphaned.bundle.design.diagram.edges = [];
  assert.doesNotThrow(() => validatePublishBody(encode(orphaned)));
  invalid((r) => { r.bundle.design.scenarios.push(structuredClone(r.bundle.design.scenarios[0])); }, "bundle.design.scenarios");
  invalid((r) => { r.bundle.design.headSha = "0".repeat(40); }, "bundle.design.headSha");
});

test("checks the document agrees with itself", () => {
  invalid((r) => { r.bundle.summary.commitCount += 1; }, "bundle.summary.commitCount");
  invalid((r) => { r.bundle.summary.fileCount += 1; }, "bundle.summary.fileCount");
  invalid((r) => { r.bundle.summary.additions += 1; }, "bundle.summary.additions");
  invalid((r) => { r.bundle.summary.deletions += 1; }, "bundle.summary.deletions");
  invalid((r) => { r.bundle.branch.range.commitCount += 1; }, "bundle.branch.range.commitCount");
  invalid((r) => { r.bundle.files.push(structuredClone(r.bundle.files[0])); }, "bundle.files");
  invalid((r) => { r.bundle.commits[0].reportId = "nope"; }, "bundle.commits.0.reportId");
  invalid((r) => { r.bundle.commitReports = [{ id: "cr1", commit: "f".repeat(40), title: "", features: [], issues: [] }]; }, "bundle.commitReports.0.commit");
});

test("enforces the app's own limits", () => {
  invalid((r) => { r.bundle.files[0].path = "a".repeat(LIMITS.maxPathLength + 1); }, "bundle.files.0.path");
  assert.equal(refusal({ ...fresh(), bundle: { ...fresh().bundle, files: Array.from({ length: LIMITS.maxFiles + 1 }, () => fresh().bundle.files[0]) } }).code, "invalid-report");
});

test("takes no code in the document: a file is listed, and carrying its text or its changes is refused", () => {
  invalid((r) => { r.bundle.files[0].head = "export const secret = 1;\n"; }, "bundle.files.0");
  invalid((r) => { r.bundle.files[0].hunks = []; }, "bundle.files.0");
  invalid((r) => { r.bundle.files[0].patch = "@@ -1 +1 @@\n+x\n"; }, "bundle.files.0");
  // The example the desktop app publishes is a few kilobytes of write-up, whatever the files held.
  assert.ok(encode(fixture).byteLength < 100_000);
});

test("says which versions it accepts when the document is not one of them", () => {
  for (const schemaVersion of [1, 2, 4, 99]) {
    const request = fresh();
    request.bundle.schemaVersion = schemaVersion;
    const error = refusal(request);
    assert.equal(error.code, "unsupported-schema-version");
    assert.deepEqual(error.details, { supported: [3] });
  }
  const request = fresh();
  request.bundle.schemaVersion = "3";
  assert.equal(refusal(request).code, "invalid-report");
});

test("reports where, at most 20 times, without echoing the document", () => {
  const request = fresh();
  request.bundle.files = request.bundle.files.map((file: Json) => ({ ...file, status: "secret-value" }));
  request.bundle.commits = request.bundle.commits.map((commit: Json) => ({ ...commit, sha: "secret-value" }));
  const error = refusal(request);
  assert.equal(error.code, "invalid-report");
  assert.ok(error.details!.issues!.length <= 20);
  assert.ok(error.details!.issues!.every((issue) => issue.path.startsWith("bundle.") && issue.message.length <= 200));
  assert.ok(!JSON.stringify(error.details).includes("secret-value"));
});

test("refuses what is not JSON, not UTF-8, or too big, before looking at the shape", () => {
  assert.equal(refusal("{not json").code, "bad-request");
  assert.equal(refusal("").code, "bad-request");
  assert.equal(refusal(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])).code, "bad-request");
  for (const value of ["null", "[]", "7", '"text"']) assert.equal(refusal(value).code, "invalid-report", value);
  const big = refusal(new Uint8Array(LIMITS.maxBodyBytes + 1));
  assert.equal(big.code, "payload-too-large");
  assert.deepEqual(big.details, { limitBytes: LIMITS.maxBodyBytes });
});

test("refuses what PostgreSQL cannot store, and what is nested too deep", () => {
  invalid((r) => { r.bundle.report.overview = "a\u0000b"; }, "bundle.report");
  invalid((r) => { r.bundle.report.overview = "a\ud800b"; }, "bundle.report");
  invalid((r) => { r.bundle.design.scenarios[0].initialState = JSON.parse('{"__proto__": 1}'); }, "bundle.design.scenarios.0");
  const withNulKey = encode(JSON.stringify(fixture).replace('"bundle"', '"bund\\u0000le"'));
  assert.equal(refusal(withNulKey).code, "invalid-report");
  const deep = `{"bundle":${"[".repeat(LIMITS.maxDepth + 10)}${"]".repeat(LIMITS.maxDepth + 10)}}`;
  assert.equal(refusal(deep).code, "invalid-report");
  const huge = `{"bundle":${"[".repeat(200_000)}${"]".repeat(200_000)}}`;
  assert.ok(["bad-request", "invalid-report"].includes(refusal(huge).code));
});

test("takes a git remote only as an address, and drops credentials from it", () => {
  for (const remote of ["javascript:alert(1)", "file:///etc/passwd", "not a remote", "https://", "ftp://example.com/a.git", "x".repeat(501)]) {
    invalid((r) => { r.repository.remote = remote; }, "repository.remote");
  }
  for (const remote of ["https://github.com/acme/payments.git", "git@github.com:acme/payments.git", "ssh://git@host/acme/p.git"]) {
    const request = fresh();
    request.repository.remote = remote;
    assert.doesNotThrow(() => validatePublishBody(encode(request)), String(remote));
  }
  // The remote is how the report is filed: without one that names a repository there is nowhere to file it.
  invalid((r) => { r.repository.remote = "https://github.com/acme"; }, "repository.remote");

  assert.equal(sanitizeRemote("https://user:secret@github.com/acme/p.git"), "https://github.com/acme/p.git");
  assert.equal(sanitizeRemote("https://ghp_token@github.com/acme/p.git"), "https://github.com/acme/p.git");
  assert.equal(sanitizeRemote("https://github.com/acme/p.git?token=abc#frag"), "https://github.com/acme/p.git");
  assert.equal(sanitizeRemote("ssh://git@host/acme/p.git"), "ssh://git@host/acme/p.git");
  assert.equal(sanitizeRemote("ssh://deploy:pw@host/acme/p.git"), "ssh://host/acme/p.git");
  assert.equal(sanitizeRemote("git@github.com:acme/p.git"), "git@github.com:acme/p.git");
  assert.equal(sanitizeRemote("deploy@host:acme/p.git"), "host:acme/p.git");
  assert.equal(sanitizeRemote(null), null);
});
