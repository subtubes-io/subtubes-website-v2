# AI API (OpenRouter proxy)

Subtubes resells models from [OpenRouter](https://openrouter.ai) through an OpenAI-compatible API. Requests are billed to an
organization, limited by its budgets, and paid for by its plan allowance and prepaid credits. Our OpenRouter key never leaves the
server.

Base URL: `https://subtubes.com/api/llm/v1`

## Authentication

Every call sends an API key: `Authorization: Bearer stl_...`.

- A key belongs to one member of one organization. Calls are billed to that organization and count against that member's limit.
- Members create keys on the organization's **API keys** page. The desktop app can create one with its session through
  `POST /api/v1/organizations/{organizationId}/llm-keys` (optional `{"label": "..."}`). The key is returned once; only a SHA-256
  hash is stored.
- `GET /api/v1/organizations/{organizationId}/llm-keys` lists the caller's keys (owners and admins see every member's keys), and
  `DELETE /api/v1/organizations/{organizationId}/llm-keys/{keyId}` revokes one.
- A key stops working when it is revoked, or when its owner leaves the organization. Each member may have 25 active keys per
  organization.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chat/completions` | OpenAI chat completions, streaming (`"stream": true`) or not |
| `GET` | `/models` | The models the key's organization has enabled, in OpenAI's list shape, with `pricing` (USD per million tokens), `context_length` and `max_output_tokens` |
| `GET` | `/usage` | This month's spend, budgets, plan allowance, credits, and the tightest remaining limit for the organization and the caller |

Any OpenAI client works:

```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "https://subtubes.com/api/llm/v1", apiKey: process.env.SUBTUBES_API_KEY });
const reply = await client.chat.completions.create({ model: "openai/gpt-6-luna", messages: [{ role: "user", content: "Hello" }] });
```

### What is forwarded

The proxy forwards only these fields:

- `messages`, `tools`, `tool_choice`, `parallel_tool_calls`
- `temperature`, `top_p`, `stop`, `seed`, `presence_penalty`, `frequency_penalty`
- `response_format`, `reasoning`, `reasoning_effort`

Every other field is dropped, including OpenRouter routing (`provider`, `models`, `plugins`, `transforms`) and `user`.

The server always sets:

- `max_tokens`, capped at the model's limit. When the request does not set it, the default is the smaller of 16,384 and the model's limit.
- `usage: {include: true}`, plus `stream_options.include_usage` when streaming.
- `provider: {data_collection: "deny", zdr: true}`: only providers that neither train on nor retain prompts and completions are used.
  `LLM_REQUIRE_ZDR=false` drops `zdr` (not recommended). A model with no zero-retention provider then fails with an upstream error,
  and the caller is not charged.
- `user`: a hash of the member's id.

Responses are OpenRouter's, passed through byte for byte. Each response carries `X-Subtubes-Request-Id`, which identifies the
request in the usage ledger.

## Order of checks

A chat request is refused at the first check it fails:

1. The service is turned on (`LLM_ENABLED`); otherwise 503.
2. The API key is valid; otherwise 401. Repeated failures from one IP get 429.
3. The caller is under the per-member rate limit; otherwise 429.
4. The member's AI access is not turned off; otherwise 403.
5. The request is JSON (otherwise 415) and within the body size limit (otherwise 413), and it is a valid request (otherwise 400).
6. The model is in the catalog (otherwise 404) and enabled for the organization (otherwise 403).
7. The request is reserved. In one transaction that locks the organization's row, the request's worst-case cost (estimated input
   tokens plus `max_tokens` of output, at catalog prices) must fit within all of these:
   - the member's in-flight request count;
   - the member's monthly limit;
   - the organization's monthly budget;
   - the available funds (plan allowance left + credits − amounts already reserved);
   - the service-wide monthly ceiling.

Concurrent requests therefore cannot overshoot any limit.

When the request finishes, the reservation is released and the actual cost is charged. That is the cost OpenRouter reports, times
`LLM_PRICE_MULTIPLIER`; the plan allowance is used first, then credits. A failed upstream call is not charged.

If a stream is cut off before its usage arrives, the request is reconciled later: `/api/cron/llm-reconcile` (every 15 minutes)
fetches the cost from OpenRouter's generation endpoint. If that cost cannot be found, it charges the estimated input plus the text
that was streamed, at catalog prices.

## Errors

Errors use OpenAI's shape: `{"error": {"message", "type", "code", "param", "details"}}`.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad JSON or fields, or the request is too long for the model |
| 401 | `invalid_api_key` | Missing, unknown or revoked key, or the owner left the organization |
| 402 | `budget_exceeded` | `details.scope` is `member` or `organization`; includes `limitUsd`, `spentUsd`, `requiredUsd`, `resetsAt` |
| 402 | `insufficient_funds` | No allowance or credits left for this request (`details.scope: "funds"`) |
| 403 | `member_disabled` | An admin turned off AI for this member |
| 403 | `model_not_enabled` | `details.enabledModels` lists what is allowed |
| 404 | `model_not_found` | The model is not in the catalog |
| 413 | `payload_too_large` | Body over `LLM_MAX_BODY_BYTES` (8 MB) |
| 415 | `unsupported_media_type` | Not `application/json` |
| 429 | `rate_limited`, `too_many_in_flight` | Includes `Retry-After` |
| 502 | `upstream_error` | The provider failed; not charged |
| 503 | `service_unavailable` | Service off, at capacity, or our provider account has a problem |

## Budgets, models and members

Owners and admins manage these on the organization's **AI usage** page:

- **Monthly budget**: the most the whole organization may spend per calendar month (UTC). Empty means no limit beyond its funds.
- **Models**: which catalog models members may use. The catalog lives in `lib/llm/models.ts`, and changing it is a deploy.
  Organizations that have not chosen get the models marked `enabledByDefault`.
- **Members**: an optional monthly limit per member, and a switch that turns AI off for one member.

Members see the organization's totals and their own spend. Warnings appear at 80% and 100% of the tightest limit.

## Billing

The organization's **Billing** page (owners and admins) uses Stripe Checkout and the Stripe billing portal:

- **Subscription (Pro)**: `STRIPE_PRICE_PRO` is the monthly price. The plan includes `LLM_PRO_ALLOWANCE_USD` of AI each month. The
  allowance applies while the subscription is `active`, `trialing` or `past_due`.
- **Credits**: one-time purchases of $5 to $1,000. Credits are used after the allowance and do not expire.

Stripe webhook: `https://subtubes.com/api/stripe/webhook`, with these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Each event is applied once. Its id is recorded in the same transaction as its effect, and a checkout session is credited at most
once.

Not handled yet: refunds and disputes do not remove credits. Adjust `llmAccount."creditMicros"` by hand if needed.

## Configuration

What we store: per request only the model, token counts, costs and timestamps (for billing). Prompts and completions are never
stored or logged by Subtubes.


| Variable | Default | Purpose |
|---|---|---|
| `LLM_ENABLED` | off | `true` turns the service on (also needs `OPENROUTER_API_KEY`). The kill switch. |
| `OPENROUTER_API_KEY` | | Our OpenRouter key. Set a credit limit on it in OpenRouter too. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Tests point this at a fake |
| `LLM_PRICE_MULTIPLIER` | `2` | What organizations pay per dollar of OpenRouter cost |
| `LLM_GLOBAL_MONTHLY_CEILING_USD` | `1000` (`0` = none) | Most all organizations together may cost us at OpenRouter per month, before the multiplier |
| `LLM_FREE_MONTHLY_ALLOWANCE_USD` | `0` | Monthly allowance for organizations without a subscription |
| `LLM_REQUIRE_ZDR` | on | Zero-data-retention providers only; `false` allows others |
| `LLM_MAX_BODY_BYTES` | 8 MB | Largest request body |
| `LLM_RATE_LIMIT_PER_MINUTE` | `60` | Requests per member per minute |
| `LLM_AUTH_FAILURES_PER_10_MINUTES` | `20` | Bad keys per IP before 429 |
| `LLM_MAX_IN_FLIGHT` | `4` | Concurrent requests per member |
| `RATE_LIMIT_BACKEND` | `postgres` | `off` disables rate limiting (local tooling only) |
| `CRON_SECRET` | | Vercel Cron sends it to `/api/cron/llm-reconcile` |
| `STRIPE_SECRET_KEY` | | Enables billing |
| `STRIPE_WEBHOOK_SECRET` | | Signing secret of the webhook endpoint |
| `STRIPE_PRICE_PRO` | | Stripe price id of the Pro plan |
| `LLM_PRO_PRICE_USD`, `LLM_PRO_ALLOWANCE_USD` | `39`, `20` | Shown price and included AI of Pro (in charged dollars, so $20 of allowance costs us at most $10 at ×2) |

## Testing

`tests/llm-unit.test.ts` runs without a server. `tests/llm-api.test.ts` runs a fake OpenRouter and Stripe on port 4789, against a
dev server pointed at it:

```bash
OPENROUTER_BASE_URL=http://127.0.0.1:4789/api/v1 OPENROUTER_API_KEY=test LLM_ENABLED=true \
STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://127.0.0.1:4789 STRIPE_WEBHOOK_SECRET=whsec_test \
STRIPE_PRICE_PRO=price_test CRON_SECRET=test-cron LLM_AUTH_FAILURES_PER_10_MINUTES=10000 npm run dev

LLM_API_TESTS=1 npx tsx --test tests/llm-api.test.ts
```

Without `LLM_API_TESTS=1`, `npm test` skips these tests. `STRIPE_API_BASE` exists only for this fake; never set it in production.
