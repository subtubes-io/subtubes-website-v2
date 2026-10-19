import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

// Runs against a live server and its database (npm run dev, TEST_BASE_URL to point elsewhere), like the other API tests.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const fixture: Json = JSON.parse(readFileSync(new URL("./fixtures/pull-request-report-publish-request.json", import.meta.url), "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const userIds: string[] = [];
const organizationIds: string[] = [];

interface Person { id: string; token: string; personalOrganizationId: string }

async function signUp(label: string): Promise<Person> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ name: `PR Reports ${label}`, email: `pr-reports-${label}-${randomUUID()}@example.test`, password: "Password123!" }),
  });
  assert.equal(response.status, 200);
  const token = response.headers.get("set-auth-token");
  assert.ok(token, "the bearer plugin should return a session token");
  const body = await response.json();
  userIds.push(body.user.id);
  const me = await (await fetch(`${baseUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return { id: body.user.id, token, personalOrganizationId: me.organizations[0].id };
}

async function teamOrganization(members: { person: Person; role: string }[]): Promise<string> {
  const id = `org_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await pool.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`, [id, "PR Reports Team", id.toLowerCase().replace(/_/g, "-")]);
  organizationIds.push(id);
  for (const { person, role } of members) {
    await pool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`, [randomUUID(), id, person.id, role]);
  }
  return id;
}

const collection = (organizationId: string) => `${baseUrl}/api/v1/organizations/${organizationId}/pull-request-reports`;
const bearer = (person: Person) => ({ Authorization: `Bearer ${person.token}` });

// A document that differs from the fixture only in what makes it a different report.
function document(reportId: string, branch = fixture.bundle.branch.name, remote = fixture.repository.remote): Json {
  const request = structuredClone(fixture);
  request.bundle.report.id = reportId;
  request.bundle.branch.name = branch;
  request.repository = { name: fixture.repository.name, remote };
  return request;
}

async function publish(person: Person, organizationId: string, request: Json, key = request.bundle.report.id, extra: Record<string, string> = {}) {
  return fetch(collection(organizationId), {
    method: "POST",
    headers: { ...bearer(person), "Content-Type": "application/json", "Idempotency-Key": key, ...extra },
    body: typeof request === "string" ? request : JSON.stringify(request),
  });
}

const get = (person: Person, url: string) => fetch(url, { headers: bearer(person) });

let alice: Person;
let bob: Person;
let carol: Person;
let team: string;

before(async () => {
  [alice, bob, carol] = [await signUp("alice"), await signUp("bob"), await signUp("carol")];
  team = await teamOrganization([
    { person: alice, role: "member" },
    { person: bob, role: "member" },
    { person: carol, role: "admin" },
  ]);
});

after(async () => {
  if (userIds.length) await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds]);
  if (organizationIds.length) await pool.query(`DELETE FROM organization WHERE id = ANY($1)`, [organizationIds]);
  await pool.end();
});

test("every answer is JSON with no-store, and errors are { error, message }", async () => {
  const unauthorized = await fetch(collection(team));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized", message: "Authentication required." });
});

test("needs a valid bearer session: no token, a bad token, or only a cookie are all 401", async () => {
  assert.equal((await fetch(collection(team), { headers: { Authorization: "Bearer not-a-real-token" } })).status, 401);
  assert.equal((await fetch(collection(team), { headers: { Authorization: "Basic abc" } })).status, 401);
  assert.equal((await fetch(collection(team), { headers: { Cookie: "better-auth.session_token=nope" } })).status, 401);
  const response = await publish({ ...alice, token: "bad" }, team, document("pr_unauthorized"));
  assert.equal(response.status, 401);
});

test("a person who is not a member gets the same answer as for an organization that does not exist", async () => {
  const notMember = await get(carol, collection(alice.personalOrganizationId));
  const missing = await get(carol, collection("org_that_does_not_exist"));
  assert.equal(notMember.status, 404);
  assert.deepEqual(await notMember.json(), await missing.json());
  assert.equal((await publish(carol, alice.personalOrganizationId, document("pr_not_member"))).status, 404);
  assert.equal((await get(carol, collection("bad id!"))).status, 400);
});

test("publishes a report: 201, with the summary taken from the document and the website's own ids and time", async () => {
  const before = Date.now();
  const response = await publish(alice, team, document("pr_publish_one"));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { created, report } = await response.json();
  assert.equal(created, true);
  assert.match(report.id, /^rpt_[A-Za-z0-9_-]+$/);
  assert.notEqual(report.id, "pr_publish_one");
  assert.deepEqual(Object.keys(report).sort(), [
    "additions", "authors", "baseBranch", "branch", "clientReportId", "commitCount", "createdAt", "createdBy", "deletions", "fileCount",
    "headSha", "id", "organizationId", "repository", "repositoryKey", "schemaVersion", "sizeBytes", "startSha", "title",
  ]);
  assert.equal(report.organizationId, team);
  assert.equal(report.clientReportId, "pr_publish_one");
  assert.equal(report.title, fixture.bundle.report.title);
  assert.equal(report.headSha, fixture.bundle.branch.range.headSha);
  assert.equal(report.fileCount, fixture.bundle.files.length);
  assert.equal(report.schemaVersion, 3);
  assert.deepEqual(report.repository, fixture.repository);
  assert.equal(report.repositoryKey, "github.com/acme/payments");
  assert.deepEqual(Object.keys(report.createdBy).sort(), ["id", "image", "name"]);
  assert.equal(report.createdBy.id, alice.id);
  assert.ok(Date.parse(report.createdAt) >= before - 1000 && Date.parse(report.createdAt) <= Date.now() + 1000);
  assert.ok(!JSON.stringify(report).includes("@example.test"), "an email address must never be shown");
});

test("the person who publishes is the session, whatever the body says", async () => {
  for (const extra of [{ createdBy: bob.id }, { userId: bob.id }, { organizationId: alice.personalOrganizationId }, { createdAt: "2020-01-01T00:00:00.000Z" }]) {
    const response = await publish(alice, team, { ...document("pr_identity"), ...extra }, "pr_identity");
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "invalid-report");
  }
});

test("publishing again is safe: the same body is 200 with the first answer, a different body is 409", async () => {
  const request = document("pr_idempotent");
  const first = await (await publish(alice, team, request)).json();
  const again = await publish(alice, team, request);
  assert.equal(again.status, 200);
  const body = await again.json();
  assert.equal(body.created, false);
  assert.deepEqual(body.report, first.report);

  const changed = document("pr_idempotent");
  changed.bundle.report.title = "A different title";
  const conflict = await publish(alice, team, changed, "pr_idempotent");
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "idempotency-conflict");

  // The key is scoped to the person: someone else using it makes their own report.
  const other = await publish(bob, team, request, "pr_idempotent");
  assert.equal(other.status, 201);
  assert.notEqual((await other.json()).report.id, first.report.id);
});

test("two publishes of the same report at the same moment make one report", async () => {
  const request = document("pr_race");
  const responses = await Promise.all(Array.from({ length: 5 }, () => publish(alice, team, request)));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
  const ids = new Set((await Promise.all(responses.map((r) => r.json()))).map((b) => b.report.id));
  assert.equal(ids.size, 1);
});

test("refuses a request that is not shaped right, with the contract's codes", async () => {
  const expectError = async (response: Response, status: number, error: string) => {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error, error);
    assert.equal(typeof body.message, "string");
    return body;
  };
  await expectError(await publish(alice, team, JSON.stringify(document("pr_x")), "pr_x", { "Content-Type": "text/plain" }), 415, "unsupported-media-type");
  await expectError(await publish(alice, team, document("pr_x"), "bad key!"), 400, "bad-request");
  await expectError(await fetch(collection(team), { method: "POST", headers: { ...bearer(alice), "Content-Type": "application/json" }, body: JSON.stringify(document("pr_x")) }), 400, "bad-request");
  await expectError(await publish(alice, team, "{not json", "pr_bad_json"), 400, "bad-request");

  const bad = document("pr_invalid");
  bad.bundle.files[0].status = "renamed";
  const invalid = await expectError(await publish(alice, team, bad), 422, "invalid-report");
  assert.ok(invalid.details.issues.some((i: Json) => i.path === "bundle.files.0.status"));

  const noRepository = document("pr_no_repository");
  delete noRepository.repository;
  const missing = await expectError(await publish(alice, team, noRepository), 422, "invalid-report");
  assert.ok(missing.details.issues.some((i: Json) => i.path === "repository"));

  const old = document("pr_old");
  old.bundle.schemaVersion = 2;
  const unsupported = await expectError(await publish(alice, team, old), 422, "unsupported-schema-version");
  assert.deepEqual(unsupported.details, { supported: [3] });

  const huge = await expectError(await publish(alice, team, "x".repeat(4_300_000), "pr_huge"), 413, "payload-too-large");
  assert.deepEqual(huge.details, { limitBytes: 4_250_000 });
});

test("a refused report stores nothing", async () => {
  const bad = document("pr_refused");
  bad.bundle.summary.fileCount += 1;
  assert.equal((await publish(alice, team, bad)).status, 422);
  const { rows } = await pool.query(`SELECT 1 FROM "pullRequestReport" WHERE "clientReportId" = 'pr_refused'`);
  assert.equal(rows.length, 0);
});

test("credentials in the git remote are dropped before it is stored or shown", async () => {
  const request = document("pr_remote");
  request.repository.remote = "https://user:secret@github.com/acme/payments.git?token=abc";
  const { report } = await (await publish(alice, team, request)).json();
  assert.equal(report.repository.remote, "https://github.com/acme/payments.git");
  assert.equal(report.repositoryKey, "github.com/acme/payments");
  const { rows } = await pool.query(`SELECT repository, document FROM "pullRequestReport" WHERE id = $1`, [report.id]);
  assert.ok(!JSON.stringify(rows[0].repository).includes("secret"));
});

test("lists an organization's reports newest first, without the documents, and pages through them", async () => {
  const org = await teamOrganization([{ person: alice, role: "member" }, { person: bob, role: "member" }]);
  const made: string[] = [];
  for (const [person, branch, id] of [[alice, "main", "pr_l1"], [bob, "feature/x", "pr_l2"], [alice, "feature/x", "pr_l3"], [bob, "main", "pr_l4"], [alice, "main", "pr_l5"]] as const) {
    const response = await publish(person, org, document(id, branch));
    assert.equal(response.status, 201);
    made.push((await response.json()).report.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const list = async (query = "") => {
    const response = await get(alice, `${collection(org)}${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };

  const all = await list();
  assert.deepEqual(all.reports.map((r: Json) => r.id), [...made].reverse());
  assert.equal(all.nextCursor, null);
  assert.ok(all.reports.every((r: Json) => !("bundle" in r) && !("document" in r)));

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page: Json = await list(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    seen.push(...page.reports.map((r: Json) => r.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.deepEqual(seen, [...made].reverse());

  assert.equal((await list("?branch=feature/x")).reports.length, 2);
  assert.equal((await list(`?createdBy=${bob.id}`)).reports.length, 2);
  assert.equal((await list(`?createdBy=${bob.id}&branch=main`)).reports.length, 1);
  assert.equal((await list("?branch=nothing")).reports.length, 0);

  for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?surprise=1", "?limit=1&limit=2", "?cursor=garbage", "?createdBy=bad%20id"]) {
    const response = await get(alice, `${collection(org)}${query}`);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, "bad-request");
  }
});

test("another organization's reports never show in a list", async () => {
  const { report } = await (await publish(alice, alice.personalOrganizationId, document("pr_private"))).json();
  const inTeam = await (await get(alice, collection(team))).json();
  assert.ok(!inTeam.reports.some((r: Json) => r.id === report.id));
  const inPersonal = await (await get(alice, collection(alice.personalOrganizationId))).json();
  assert.deepEqual(inPersonal.reports.map((r: Json) => r.id), [report.id]);
});

test("reads a report back exactly as it was published, and only through its own organization", async () => {
  const request = document("pr_read");
  const { report } = await (await publish(alice, team, request)).json();
  const response = await get(bob, `${collection(team)}/${report.id}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.report, report);
  assert.deepEqual(body.bundle, request.bundle);
  assert.equal(body.bundle.report.id, "pr_read");

  // The report is in another organization: not found, never forbidden.
  const elsewhere = await get(alice, `${collection(alice.personalOrganizationId)}/${report.id}`);
  assert.equal(elsewhere.status, 404);
  assert.equal((await elsewhere.json()).error, "report-not-found");
  assert.equal((await get(bob, `${collection(team)}/rpt_missing`)).status, 404);
  assert.equal((await get(bob, `${collection(team)}/bad%20id`)).status, 400);
  assert.equal((await get(carol, `${collection(alice.personalOrganizationId)}/${report.id}`)).status, 404);
});

test("deleting: the publisher or an owner or admin may, another member may not", async () => {
  const { report } = await (await publish(alice, team, document("pr_delete"))).json();
  const url = `${collection(team)}/${report.id}`;

  const refused = await fetch(url, { method: "DELETE", headers: bearer(bob) });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "forbidden");
  assert.equal((await get(bob, url)).status, 200);

  const asAdmin = await fetch(url, { method: "DELETE", headers: bearer(carol) });
  assert.equal(asAdmin.status, 204);
  assert.equal(await asAdmin.text(), "");
  assert.equal((await get(alice, url)).status, 404);
  const gone = await fetch(url, { method: "DELETE", headers: bearer(alice) });
  assert.equal(gone.status, 404);
  assert.equal((await gone.json()).error, "report-not-found");

  const mine = await (await publish(bob, team, document("pr_delete_mine"))).json();
  assert.equal((await fetch(`${collection(team)}/${mine.report.id}`, { method: "DELETE", headers: bearer(bob) })).status, 204);
  // Someone outside the organization cannot even learn that it exists.
  const theirs = await (await publish(alice, team, document("pr_delete_theirs"))).json();
  const outsider = await fetch(`${collection(team)}/${theirs.report.id}`, { method: "DELETE", headers: bearer({ ...alice, id: "x", token: (await signUp("dave")).token }) });
  assert.equal(outsider.status, 404);
});

test("publishing the same report again after deleting it makes a new report", async () => {
  const request = document("pr_republish");
  const first = await (await publish(alice, team, request)).json();
  await fetch(`${collection(team)}/${first.report.id}`, { method: "DELETE", headers: bearer(alice) });
  const again = await publish(alice, team, request);
  assert.equal(again.status, 201);
  assert.notEqual((await again.json()).report.id, first.report.id);
});

test("deleting the organization or the account deletes its reports", async () => {
  const dave = await signUp("erin");
  const org = await teamOrganization([{ person: dave, role: "owner" }]);
  const { report } = await (await publish(dave, org, document("pr_cascade"))).json();
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [dave.id]);
  const { rows } = await pool.query(`SELECT 1 FROM "pullRequestReport" WHERE id = $1`, [report.id]);
  assert.equal(rows.length, 0);
});

test("files a report under its repository, whichever way the remote is written, and lists one repository's reports only", async () => {
  const org = await teamOrganization([{ person: alice, role: "member" }, { person: bob, role: "member" }]);
  const made: Record<string, string> = {};
  for (const [id, remote] of [
    ["pr_k1", "https://github.com/Acme/Payments.git"],
    ["pr_k2", "git@github.com:acme/payments.git"],
    ["pr_k3", "https://github.com/acme/ledger.git"],
    ["pr_k4", "https://gitlab.com/acme/payments.git"],
  ] as const) {
    const response = await publish(alice, org, document(id, "main", remote));
    assert.equal(response.status, 201, id);
    const { report } = await response.json();
    made[id] = report.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const list = async (query: string) => (await (await get(bob, `${collection(org)}${query}`)).json()).reports.map((r: Json) => r.id);
  assert.deepEqual(await list("?repository=github.com%2Facme%2Fpayments"), [made.pr_k2, made.pr_k1]);
  assert.deepEqual(await list("?repository=github.com%2Facme%2Fledger"), [made.pr_k3]);
  assert.deepEqual(await list("?repository=gitlab.com%2Facme%2Fpayments"), [made.pr_k4]);
  assert.deepEqual(await list("?repository=github.com%2Facme%2Fnothing"), []);
  assert.equal((await list("")).length, 4);
  // A repository filter combines with the others.
  assert.deepEqual(await list(`?repository=github.com%2Facme%2Fpayments&createdBy=${bob.id}`), []);
  for (const bad of ["", "github.com", "GitHub.com%2FAcme%2FPayments", "https%3A%2F%2Fgithub.com%2Facme%2Fpayments", "github.com%2Facme%2Fpay%20ments"]) {
    const response = await get(bob, `${collection(org)}?repository=${bad}`);
    assert.equal(response.status, 400, bad);
  }
  // Someone in another organization never sees them, whatever repository they ask for.
  assert.equal((await get(carol, `${collection(org)}?repository=github.com%2Facme%2Fpayments`)).status, 404);
});

const move = (person: Person, organizationId: string, body: unknown) =>
  fetch(`${collection(organizationId)}/move`, { method: "POST", headers: { ...bearer(person), "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("moves reports to another repository: the publisher's own, or all of them for an owner or admin, and says how many it could not", async () => {
  const org = await teamOrganization([{ person: alice, role: "member" }, { person: bob, role: "member" }, { person: carol, role: "admin" }]);
  const old = "https://github.com/acme/payments.git";
  const renamed = { name: "acme-co/payments", remote: "https://user:secret@github.com/acme-co/payments.git" };
  for (const [person, id] of [[alice, "pr_m1"], [alice, "pr_m2"], [bob, "pr_m3"]] as const) assert.equal((await publish(person, org, document(id, "main", old))).status, 201);
  const keys = async () => (await (await get(carol, collection(org))).json()).reports.map((r: Json) => `${r.clientReportId}:${r.repositoryKey}`).sort();

  // A member moves their own and skips the one that is not theirs.
  const first = await move(alice, org, { from: "github.com/acme/payments", to: renamed });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { moved: 2, skipped: 1 });
  assert.deepEqual(await keys(), ["pr_m1:github.com/acme-co/payments", "pr_m2:github.com/acme-co/payments", "pr_m3:github.com/acme/payments"]);
  // Credentials in the new remote are dropped, and the document is untouched.
  const stored = await pool.query(`SELECT repository, document->'report'->>'id' AS id FROM "pullRequestReport" WHERE "clientReportId" = 'pr_m1'`);
  assert.deepEqual(stored.rows[0].repository, { name: "acme-co/payments", remote: "https://github.com/acme-co/payments.git" });
  assert.equal(stored.rows[0].id, "pr_m1");

  // Moving again finds nothing under the old repository.
  assert.deepEqual(await (await move(alice, org, { from: "github.com/acme/payments", to: renamed })).json(), { moved: 0, skipped: 1 });

  // An admin moves what is left, whoever published it.
  assert.deepEqual(await (await move(carol, org, { from: "github.com/acme/payments", to: renamed })).json(), { moved: 1, skipped: 0 });
  assert.deepEqual(await keys(), ["pr_m1:github.com/acme-co/payments", "pr_m2:github.com/acme-co/payments", "pr_m3:github.com/acme-co/payments"]);
  assert.deepEqual(await (await move(alice, org, { from: "github.com/nothing/here", to: renamed })).json(), { moved: 0, skipped: 0 });
});

test("a move is checked like everything else: who, what, and how big", async () => {
  const error = async (response: Response, status: number, code: string) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  };
  const to = { name: "x/y", remote: "https://github.com/x/y.git" };
  await error(await fetch(`${collection(team)}/move`, { method: "POST", body: "{}" }), 401, "unauthorized");
  await error(await move(carol, alice.personalOrganizationId, { from: "github.com/a/b", to }), 404, "organization-not-found");
  await error(await fetch(`${collection(team)}/move`, { method: "POST", headers: { ...bearer(alice), "Content-Type": "text/plain" }, body: "{}" }), 415, "unsupported-media-type");
  await error(await move(alice, team, "{not json"), 400, "bad-request");
  for (const body of [{}, { from: "github.com/a/b" }, { from: "https://github.com/a/b", to }, { from: "github.com/a/b", to: { name: "x", remote: "nonsense" } }, { from: "github.com/a/b", to, extra: 1 }, { from: "github.com/a/b", to: { ...to, extra: 1 } }]) {
    await error(await move(alice, team, body), 422, "invalid-report");
  }
  await error(await move(alice, team, { from: "github.com/a/b", to, pad: "x".repeat(5000) }), 413, "payload-too-large");
  assert.equal((await fetch(`${collection(team)}/move`, { headers: bearer(alice) })).status, 405);
});
