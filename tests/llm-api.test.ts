import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import Stripe from "stripe";
import { estimateInputTokens, worstCaseMicros } from "../lib/llm/money";
import { findModel } from "../lib/llm/models";

loadEnvConfig(process.cwd());

// The AI proxy, budgets and billing end to end, against a live server whose OpenRouter and Stripe are a fake run by this file. Start
// the server with the settings in docs/llm-api.md ("Testing") and run with LLM_API_TESTS=1; without it these tests are skipped.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const enabled = process.env.LLM_API_TESTS === "1";
const skip = enabled ? false : "set LLM_API_TESTS=1 and start the server against the fake OpenRouter (docs/llm-api.md)";
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";
const fakePort = Number(process.env.LLM_TEST_FAKE_PORT || 4789);
const webhookSecret = process.env.LLM_TEST_WEBHOOK_SECRET || "whsec_test";
const cronSecret = process.env.LLM_TEST_CRON_SECRET || "test-cron";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const userIds: string[] = [];
const organizationIds: string[] = [];

const LUNA = "openai/gpt-6-luna";
// The server's price multiplier: tests run against its default unless LLM_PRICE_MULTIPLIER is set for both.
const MULTIPLIER = Number(process.env.LLM_PRICE_MULTIPLIER || 2);
const charge = (micros: number) => Math.ceil(micros * MULTIPLIER);
const SOL = "openai/gpt-6.1-sol";

// --- The fake OpenRouter and Stripe -------------------------------------------------------------------------------------------------

const upstreamBodies: Json[] = [];
/** What the fake Stripe returns for a subscription: the webhook handler reads the current state rather than the event's. */
const subscriptions = new Map<string, Json>();
let fake: Server;

const STREAM_EVENTS = [
  `: OPENROUTER PROCESSING\n\n`,
  `data: {"id":"gen-stream-1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"}}]}\n\n`,
  `data: {"id":"gen-stream-1","choices":[{"index":0,"delta":{"content":"lo!"},"finish_reason":"stop"}]}\n\n`,
  `data: {"id":"gen-stream-1","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":2,"cost":0.000321}}\n\n`,
  `data: [DONE]\n\n`,
];

const text = (body: Json) => {
  const last = body.messages?.at(-1)?.content;
  return typeof last === "string" ? last : "";
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readAll(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleFake(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://fake");
  const raw = await readAll(req);

  if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
    const body = JSON.parse(raw);
    upstreamBodies.push(body);
    const prompt = text(body);
    if (prompt.includes("[fail]")) return send(res, 500, { error: { message: "provider exploded" } });
    if (prompt.includes("[slow]")) await new Promise((resolve) => setTimeout(resolve, 400));
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (prompt.includes("[hang]")) {
        res.write(`data: {"id":"gen-hang-1","choices":[{"index":0,"delta":{"content":"partial answer"}}]}\n\n`);
        return; // Never ends; the client leaves.
      }
      for (const event of STREAM_EVENTS) {
        res.write(event);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return res.end();
    }
    return send(res, 200, {
      id: "gen-plain-1", object: "chat.completion", model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "Hi there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 9, completion_tokens: 3, cost: 0.000123, prompt_tokens_details: { cached_tokens: 0 } },
    });
  }
  if (req.method === "GET" && url.pathname === "/api/v1/generation") {
    if (url.searchParams.get("id") === "gen-hang-1") {
      return send(res, 200, { data: { total_cost: 0.0005, tokens_prompt: 20, tokens_completion: 4 } });
    }
    return send(res, 404, { error: { message: "not found" } });
  }
  // Stripe: just enough for a checkout and the billing portal.
  if (req.method === "POST" && url.pathname === "/v1/customers") return send(res, 200, { id: `cus_${randomUUID().slice(0, 8)}`, object: "customer" });
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const id = `cs_test_${randomUUID().slice(0, 8)}`;
    return send(res, 200, { id, object: "checkout.session", url: `https://checkout.stripe.test/${id}`, form: raw });
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/subscriptions/")) {
    const subscription = subscriptions.get(decodeURIComponent(url.pathname.slice("/v1/subscriptions/".length)));
    return subscription ? send(res, 200, subscription) : send(res, 404, { error: { message: "No such subscription" } });
  }
  if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
    return send(res, 200, { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.test/session" });
  }
  send(res, 404, { error: { message: `fake has no ${req.method} ${url.pathname}` } });
}

// --- People, organizations and calls -----------------------------------------------------------------------------------------------

interface Person { id: string; token: string; personalOrganizationId: string }

async function signUp(label: string): Promise<Person> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ name: `LLM ${label}`, email: `llm-${label}-${randomUUID()}@example.test`, password: "Password123!" }),
  });
  assert.equal(response.status, 200);
  const token = response.headers.get("set-auth-token");
  assert.ok(token);
  const body = await response.json();
  userIds.push(body.user.id);
  const me = await (await fetch(`${baseUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return { id: body.user.id, token, personalOrganizationId: me.organizations[0].id };
}

async function teamOrganization(members: { person: Person; role: string }[]): Promise<string> {
  const id = `org_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await pool.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, now())`, [id, "LLM Team", id.toLowerCase().replace(/_/g, "-")]);
  organizationIds.push(id);
  for (const { person, role } of members) {
    await pool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`, [randomUUID(), id, person.id, role]);
  }
  return id;
}

/** A management call from the website: the session (as a bearer token here) and the website's own Origin. */
function manage(person: Person, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${person.token}`, Origin: baseUrl, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createKey(person: Person, organizationId: string, label = "test"): Promise<string> {
  const response = await manage(person, "POST", `/api/organizations/${organizationId}/ai/keys`, { label });
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  assert.match(body.key, /^stl_/);
  return body.key;
}

const chatBody = (overrides: Json = {}) => ({ model: LUNA, max_tokens: 100, messages: [{ role: "user", content: "Say hello" }], ...overrides });

function chat(key: string | null, body: Json = chatBody(), init: RequestInit = {}) {
  return fetch(`${baseUrl}/api/llm/v1/chat/completions`, {
    method: "POST",
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

async function expectError(response: Response, status: number, code: string): Promise<Json> {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.error?.code, code, JSON.stringify(body));
  return body.error;
}

async function usageRow(id: string): Promise<Json> {
  const { rows } = await pool.query(`SELECT * FROM "llmUsage" WHERE id = $1`, [id]);
  return rows[0];
}

/** Settlement of a stream runs after the response; wait for it. */
async function settledRow(id: string, statuses = ["settled"]): Promise<Json> {
  for (let i = 0; i < 50; i++) {
    const row = await usageRow(id);
    if (row && statuses.includes(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`usage ${id} was not ${statuses.join("/")} in time: ${JSON.stringify(await usageRow(id))}`);
}

const stripeSigner = new Stripe("sk_test_signer");
function webhook(event: Json, secret = webhookSecret) {
  const payload = JSON.stringify(event);
  return fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": stripeSigner.webhooks.generateTestHeaderString({ payload, secret }) },
    body: payload,
  });
}

function creditEvent(organizationId: string, usd: number, sessionId = `cs_test_${randomUUID().slice(0, 8)}`) {
  return {
    id: `evt_${randomUUID().replace(/-/g, "")}`, object: "event", type: "checkout.session.completed",
    data: { object: {
      id: sessionId, object: "checkout.session", payment_status: "paid", amount_total: usd * 100,
      metadata: { organizationId, kind: "credits", creditMicros: String(usd * 1_000_000) },
    } },
  };
}

async function credits(organizationId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT "creditMicros" FROM "llmAccount" WHERE "organizationId" = $1`, [organizationId]);
  return Number(rows[0]?.creditMicros ?? 0);
}

// --- Setup ---------------------------------------------------------------------------------------------------------------------------

let owner: Person;
let alice: Person;
let bob: Person;
let outsider: Person;
let team: string;
let aliceKey: string;
let bobKey: string;

before(async () => {
  if (!enabled) return;
  fake = createServer((req, res) => void handleFake(req, res).catch((error) => send(res, 500, { error: { message: String(error) } })));
  await new Promise<void>((resolve) => fake.listen(fakePort, "127.0.0.1", resolve));
  [owner, alice, bob, outsider] = [await signUp("owner"), await signUp("alice"), await signUp("bob"), await signUp("outsider")];
  team = await teamOrganization([{ person: owner, role: "owner" }, { person: alice, role: "member" }, { person: bob, role: "member" }]);
  aliceKey = await createKey(alice, team, "alice laptop");
  bobKey = await createKey(bob, team, "bob laptop");
});

after(async () => {
  if (!enabled) return pool.end();
  if (organizationIds.length) await pool.query(`DELETE FROM organization WHERE id = ANY($1)`, [organizationIds]);
  if (userIds.length) {
    await pool.query(`DELETE FROM organization WHERE id IN (SELECT "organizationId" FROM member WHERE "userId" = ANY($1))`, [userIds]);
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds]);
  }
  await pool.end();
  await new Promise((resolve) => fake.close(resolve));
});

// --- Tests ---------------------------------------------------------------------------------------------------------------------------

test("calls without a valid key are refused in OpenAI's error shape", { skip }, async () => {
  await expectError(await chat(null), 401, "invalid_api_key");
  await expectError(await chat("stl_not-a-real-key"), 401, "invalid_api_key");
  await expectError(await chat(`Bearer ${owner.token}`.slice(7)), 401, "invalid_api_key"); // A website session is not an API key.
  const unknown = await fetch(`${baseUrl}/api/llm/v1/embeddings`, { method: "POST", headers: { Authorization: `Bearer ${aliceKey}` } });
  assert.equal(unknown.status, 404);
});

test("keys belong to one member: others cannot revoke them, managers can see and revoke all", { skip }, async () => {
  const list = async (person: Person) => (await (await fetch(`${baseUrl}/api/v1/organizations/${team}/llm-keys`, {
    headers: { Authorization: `Bearer ${person.token}` },
  })).json()).keys as Json[];
  const aliceSees = await list(alice);
  assert.deepEqual(aliceSees.map((k) => k.label), ["alice laptop"], "a member sees only their own keys");
  assert.ok(aliceSees.every((k) => !("key" in k) && !("keyHash" in k)), "listing never returns the secret");
  const ownerSees = await list(owner);
  assert.equal(ownerSees.length, 2, "a manager sees every member's keys");

  const bobsKeyId = ownerSees.find((k) => k.label === "bob laptop").id;
  assert.equal((await manage(alice, "DELETE", `/api/organizations/${team}/ai/keys/${bobsKeyId}`)).status, 404);
  assert.equal((await manage(outsider, "POST", `/api/organizations/${team}/ai/keys`, {})).status, 404, "outsiders do not learn the organization exists");
  const crossSite = await fetch(`${baseUrl}/api/organizations/${team}/ai/keys`, {
    method: "POST", headers: { Authorization: `Bearer ${alice.token}`, Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(crossSite.status, 403, "management routes refuse other origins");

  const temporary = await createKey(bob, team, "temporary");
  const temporaryId = (await list(owner)).find((k) => k.label === "temporary").id;
  assert.equal((await manage(owner, "DELETE", `/api/organizations/${team}/ai/keys/${temporaryId}`)).status, 204);
  await expectError(await chat(temporary), 401, "invalid_api_key");
});

test("only owners and admins change budgets, models and member limits", { skip }, async () => {
  assert.equal((await manage(alice, "PUT", `/api/organizations/${team}/ai/settings`, { monthlyLimitUsd: 1000 })).status, 403);
  assert.equal((await manage(alice, "PUT", `/api/organizations/${team}/ai/members/${alice.id}`, { monthlyLimitUsd: null, disabled: false })).status, 403);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { enabledModels: ["not/a-model"] })).status, 400);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { monthlyLimitUsd: -1 })).status, 400);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/members/${outsider.id}`, { monthlyLimitUsd: 1, disabled: false })).status, 404);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { enabledModels: [LUNA, SOL] })).status, 200);
});

test("an organization without allowance or credits is refused before anything is sent upstream", { skip }, async () => {
  const before = upstreamBodies.length;
  const error = await expectError(await chat(aliceKey), 402, "insufficient_funds");
  assert.equal(error.details.scope, "funds");
  assert.equal(upstreamBodies.length, before);
});

test("Stripe webhooks add credits once, and unsigned events are refused", { skip }, async () => {
  const forged = await webhook(creditEvent(team, 500), "whsec_wrong");
  assert.equal(forged.status, 400);
  assert.equal(await credits(team), 0);

  const event = creditEvent(team, 5);
  assert.equal((await webhook(event)).status, 200);
  assert.equal(await credits(team), 5_000_000);
  const again = await webhook(event);
  assert.equal((await again.json()).result, "duplicate");
  const sameCheckout = await webhook({ ...creditEvent(team, 5, event.data.object.id) });
  assert.equal((await sameCheckout.json()).result, "ignored", "a checkout session is credited once even under another event id");
  assert.equal(await credits(team), 5_000_000);

  const underpaid = creditEvent(team, 50);
  underpaid.data.object.amount_total = 100;
  await webhook(underpaid);
  assert.equal(await credits(team), 5_000_000, "credits never exceed what was paid");
});

test("a plain completion is passed through and its reported cost is charged", { skip }, async () => {
  const response = await chat(aliceKey, chatBody({
    temperature: 0.3, provider: { order: ["cheap"] }, plugins: [{ id: "web" }], user: "spoofed", models: [SOL],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.choices[0].message.content, "Hi there");
  const usageId = response.headers.get("x-subtubes-request-id")!;

  const sent = upstreamBodies.at(-1);
  assert.equal(sent.model, LUNA);
  assert.equal(sent.temperature, 0.3);
  assert.equal(sent.max_tokens, 100);
  assert.deepEqual(sent.provider, { data_collection: "deny", zdr: true });
  assert.equal(sent.plugins, undefined);
  assert.equal(sent.models, undefined);
  assert.notEqual(sent.user, "spoofed");
  assert.ok(!JSON.stringify(sent).includes(alice.id), "the member's id is not sent upstream");

  const row = await settledRow(usageId);
  assert.equal(Number(row.upstreamCostMicros), 123);
  assert.equal(Number(row.chargedMicros), charge(123));
  assert.equal(row.userId, alice.id);
  assert.equal(await credits(team), 5_000_000 - charge(123), "with no plan allowance, credits pay");
  const { rows: [period] } = await pool.query(`SELECT "spentMicros", "reservedMicros" FROM "llmOrgPeriod" WHERE "organizationId" = $1`, [team]);
  assert.equal(Number(period.spentMicros), charge(123));
  assert.equal(Number(period.reservedMicros), 0, "the reservation is released");
});

test("a stream is passed through byte for byte and settled from its final usage", { skip }, async () => {
  const response = await chat(aliceKey, chatBody({ stream: true }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(await response.text(), STREAM_EVENTS.join(""));
  assert.deepEqual(upstreamBodies.at(-1).stream_options, { include_usage: true });
  const row = await settledRow(response.headers.get("x-subtubes-request-id")!);
  assert.equal(row.generationId, "gen-stream-1");
  assert.equal(Number(row.chargedMicros), charge(321));
  assert.equal(row.inputTokens, 11);
  assert.equal(row.outputTokens, 2);
});

test("models outside the catalog or not enabled are refused", { skip }, async () => {
  await expectError(await chat(aliceKey, chatBody({ model: "openai/gpt-2" })), 404, "model_not_found");
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { enabledModels: [LUNA] })).status, 200);
  const error = await expectError(await chat(aliceKey, chatBody({ model: SOL })), 403, "model_not_enabled");
  assert.deepEqual(error.details.enabledModels, [LUNA]);
  const models = await (await fetch(`${baseUrl}/api/llm/v1/models`, { headers: { Authorization: `Bearer ${aliceKey}` } })).json();
  assert.deepEqual(models.data.map((m: Json) => m.id), [LUNA]);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { enabledModels: [LUNA, SOL] })).status, 200);
});

test("a member's monthly limit and the AI switch apply to that member only", { skip }, async () => {
  const path = `/api/organizations/${team}/ai/members/${alice.id}`;
  assert.equal((await manage(owner, "PUT", path, { monthlyLimitUsd: 0.01, disabled: false })).status, 200);
  // The worst case of 2,000 output tokens at $10/M is $0.02, over the $0.01 limit; it is refused before running.
  const error = await expectError(await chat(aliceKey, chatBody({ model: SOL, max_tokens: 2_000 })), 402, "budget_exceeded");
  assert.equal(error.details.scope, "member");
  assert.equal((await chat(bobKey, chatBody({ model: SOL, max_tokens: 2_000 }))).status, 200, "other members are not limited");

  assert.equal((await manage(owner, "PUT", path, { monthlyLimitUsd: null, disabled: true })).status, 200);
  await expectError(await chat(aliceKey), 403, "member_disabled");
  const usage = await (await fetch(`${baseUrl}/api/llm/v1/usage`, { headers: { Authorization: `Bearer ${aliceKey}` } })).json();
  assert.equal(usage.member.disabled, true);
  assert.equal((await manage(owner, "PUT", path, { monthlyLimitUsd: null, disabled: false })).status, 200);
  assert.equal((await chat(aliceKey)).status, 200);
});

test("the organization's monthly budget stops everyone", { skip }, async () => {
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { monthlyLimitUsd: 0.01 })).status, 200);
  const error = await expectError(await chat(bobKey, chatBody({ model: SOL, max_tokens: 2_000 })), 402, "budget_exceeded");
  assert.equal(error.details.scope, "organization");
  const usage = await (await fetch(`${baseUrl}/api/llm/v1/usage`, { headers: { Authorization: `Bearer ${bobKey}` } })).json();
  assert.equal(usage.organization.budgetUsd, 0.01);
  assert.equal((await manage(owner, "PUT", `/api/organizations/${team}/ai/settings`, { monthlyLimitUsd: null })).status, 200);
});

test("concurrent requests cannot spend more than the organization has", { skip }, async () => {
  const org = await teamOrganization([{ person: bob, role: "member" }]);
  const key = await createKey(bob, org);
  const body = chatBody({ model: SOL, max_tokens: 1_000, messages: [{ role: "user", content: "[slow] count to ten" }] });
  const estimate = worstCaseMicros(findModel(SOL)!, estimateInputTokens(body), 1_000, MULTIPLIER);
  // Credits for two and a half worst cases: exactly two of four simultaneous requests may run.
  await pool.query(`INSERT INTO "llmAccount" ("organizationId", "creditMicros") VALUES ($1, $2)`, [org, Math.floor(estimate * 2.5)]);
  const responses = await Promise.all(Array.from({ length: 4 }, () => chat(key, body)));
  const statuses = responses.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 402, 402]);
  await Promise.all(responses.map((r) => r.text()));
});

test("a failed upstream call is not charged", { skip }, async () => {
  const before = await credits(team);
  const response = await chat(bobKey, chatBody({ messages: [{ role: "user", content: "[fail]" }] }));
  await expectError(response, 502, "upstream_error");
  const { rows } = await pool.query(`SELECT status, "chargedMicros", "upstreamStatus" FROM "llmUsage" WHERE "organizationId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [team]);
  assert.equal(rows[0].status, "failed");
  assert.equal(Number(rows[0].chargedMicros), 0);
  assert.equal(await credits(team), before);
});

test("a stream the client leaves is reconciled from OpenRouter's generation record", { skip }, async () => {
  const controller = new AbortController();
  const response = await chat(aliceKey, chatBody({ stream: true, messages: [{ role: "user", content: "[hang]" }] }), { signal: controller.signal });
  assert.equal(response.status, 200);
  const usageId = response.headers.get("x-subtubes-request-id")!;
  const reader = response.body!.getReader();
  await reader.read();
  controller.abort();
  const aborted = await settledRow(usageId, ["aborted"]);
  assert.equal(aborted.generationId, "gen-hang-1");

  assert.equal((await fetch(`${baseUrl}/api/cron/llm-reconcile`)).status, 401);
  await pool.query(`UPDATE "llmUsage" SET "createdAt" = now() - interval '2 minutes' WHERE id = $1`, [usageId]);
  const cron = await fetch(`${baseUrl}/api/cron/llm-reconcile`, { headers: { Authorization: `Bearer ${cronSecret}` } });
  assert.equal(cron.status, 200);
  const row = await usageRow(usageId);
  assert.equal(row.status, "settled");
  assert.equal(Number(row.chargedMicros), charge(500));
});

test("subscriptions set the monthly allowance, which is used before credits", { skip }, async () => {
  const checkout = await manage(owner, "POST", `/api/organizations/${team}/billing/checkout`, { kind: "subscription", planId: "pro" });
  assert.equal(checkout.status, 200, await checkout.clone().text());
  assert.match((await checkout.json()).url, /^https:\/\/checkout\.stripe\.test\//);
  assert.equal((await manage(alice, "POST", `/api/organizations/${team}/billing/checkout`, { kind: "credits", amountUsd: 10 })).status, 403);
  assert.equal((await manage(owner, "POST", `/api/organizations/${team}/billing/checkout`, { kind: "credits", amountUsd: 3 })).status, 400);

  const state = (status: string) => ({
    id: "sub_test_1", object: "subscription", customer: "cus_unused", status, cancel_at_period_end: false,
    metadata: { organizationId: team, planId: "pro" },
    items: { data: [{ price: { id: process.env.STRIPE_PRICE_PRO || "price_test" }, current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30 }] },
  });
  const subscription = (status: string, type = "customer.subscription.updated") => ({
    id: `evt_${randomUUID().replace(/-/g, "")}`, object: "event", type, data: { object: state(status) },
  });
  subscriptions.set("sub_test_1", state("active"));
  assert.equal((await webhook(subscription("active"))).status, 200);
  const usage = await (await fetch(`${baseUrl}/api/llm/v1/usage`, { headers: { Authorization: `Bearer ${aliceKey}` } })).json();
  assert.equal(usage.plan.id, "pro");
  assert.ok(usage.organization.allowanceUsd > 0);

  const creditsBefore = await credits(team);
  assert.equal((await chat(aliceKey)).status, 200);
  assert.equal(await credits(team), creditsBefore, "the allowance pays first");

  assert.equal((await manage(owner, "POST", `/api/organizations/${team}/billing/checkout`, { kind: "subscription", planId: "pro" })).status, 400, "an organization subscribes once");
  const portal = await manage(owner, "POST", `/api/organizations/${team}/billing/portal`, {});
  assert.equal(portal.status, 200);

  subscriptions.set("sub_test_1", state("canceled"));
  await webhook(subscription("canceled", "customer.subscription.deleted"));
  const usageNow = async () => (await (await fetch(`${baseUrl}/api/llm/v1/usage`, { headers: { Authorization: `Bearer ${aliceKey}` } })).json());
  assert.equal((await usageNow()).plan.id, "free");
  // Stripe delivered an older "active" update late: the subscription is read from Stripe, so the cancellation stands.
  assert.equal((await webhook(subscription("active"))).status, 200);
  const late = await usageNow();
  assert.equal(late.plan.id, "free");
  assert.equal(late.organization.allowanceUsd, 0);
});

test("removing someone from the organization stops their keys", { skip }, async () => {
  await pool.query(`DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2`, [team, bob.id]);
  await expectError(await chat(bobKey), 401, "invalid_api_key");
});
