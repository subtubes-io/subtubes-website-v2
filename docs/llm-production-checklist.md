# AI API: production checklist

What to do before the OpenRouter integration (commit `4ced860`, branch `edgar/openrouter`) goes live. Details of the API, the
settings and Stripe are in [llm-api.md](./llm-api.md).

## 1. Pricing and data decisions

Decided, and now the defaults in code and `.env.example`:

- [x] **Margin: ×2.** `LLM_PRICE_MULTIPLIER=2`. Teams pay twice OpenRouter's cost; every budget, limit, allowance and credit is in
      these charged dollars.
- [x] **Pro plan: $39 a month** (`LLM_PRO_PRICE_USD=39`) with **$20 of AI included** (`LLM_PRO_ALLOWANCE_USD=20`). Because the allowance
      is in charged dollars, it costs us at most $10 at OpenRouter, so a fully used Pro plan leaves about $29 before Stripe fees.
      Change `LLM_PRO_ALLOWANCE_USD` if the offer should include a different amount; the Stripe price must be $39 to match.
- [x] **No free tier.** `LLM_FREE_MONTHLY_ALLOWANCE_USD=0`. Teams subscribe or buy credits before they can use AI.
- [x] **No data kept.** `LLM_REQUIRE_ZDR=true` (now the default): OpenRouter only routes to providers that neither train on nor
      retain prompts and completions. Subtubes itself stores only model, token counts, costs and timestamps for billing, never the
      prompts or replies.
      - [x] All 9 catalog models have zero-retention providers on OpenRouter (checked 2026-10-20 via `/api/v1/endpoints/zdr`).
            Recheck when adding a model: one without a zero-retention provider fails with an upstream error (not charged).

- [x] **Overall monthly ceiling: $1,000.** `LLM_GLOBAL_MONTHLY_CEILING_USD=1000`. This is one limit for **all accounts together**, not per
      account: the most Subtubes will spend at OpenRouter in a calendar month across every organization, measured in what we pay
      (before the ×2). When it is reached, every request from every team gets `503 service_unavailable` until the 1st, even
      teams with credits left. It is a safety net against a bug, an abused key or a run of heavy users.
      Per-account limits are separate: each organization's budget and each member's limit, set on the AI usage page.
      $1,000 of OpenRouter cost is about $2,000 of customer spend at ×2. `0` means no ceiling.

- [x] **Model catalog.** The 9 models and their prices in `lib/llm/models.ts` match OpenRouter's list (checked 2026-10-20).
      Prices are only used for the up-front estimate; recheck them when OpenRouter changes pricing or a model is added.

## 2. OpenRouter

- [ ] Sign up as an **Organization** (e.g. "Subtubes"), not Individual. Our app is the only caller and does its own per-team
      metering, so OpenRouter's team features aren't needed, but an organization account keeps billing and keys in the company's
      name and lets other people administer it if you leave or are away. Either type works with the code.
- [ ] Optional backstop to `LLM_REQUIRE_ZDR` (the app already sends `zdr: true` on every request, so this only matters if that
      code is ever changed). OpenRouter moved these settings and the workspace Settings page has no ZDR switch, so use a guardrail:
      1. Open <https://openrouter.ai/workspaces/default/guardrails> and click **New Guardrail** (e.g. "Subtubes ZDR").
      2. Under **Zero Data Retention**, turn it on for all five groups: Anthropic, OpenAI, Google, SpaceXAI, All other models.
         Leave the budget, model and provider lists empty: our app does its own budgets and model access, and the workspace
         budget is already set (see the API key step below).
      3. Save, then assign it under the guardrail's **API Keys** section to the production key. A guardrail does nothing until
         it is assigned.
      4. Check the guardrail's eligibility preview: the 9 catalog models must still be listed.
      If a Settings → Privacy page does appear in your account (<https://openrouter.ai/settings/privacy>), check that
      "OpenRouter use of inputs/outputs" (the 1% discount option) is **off**; it is off by default.
- [ ] Observability settings (<https://openrouter.ai/workspaces/default/observability>): leave "Private input & output logging"
      **off**, so OpenRouter keeps no prompts or completions in its logs.
- [ ] Create a production API key (Settings → API Keys) named e.g. `subtubes-prod`, with a credit limit of about **$1,100**:
      a little above the $1,000 app ceiling, so the app's ceiling trips first with a clean error and the key limit is only the
      backstop if our accounting goes wrong. Same for the workspace budget (workspace Settings → Workspace budget, monthly):
      set it to about $1,100 too. The key is shown once; paste it straight into Vercel (section 4), never into a
      file in the repo.
- [ ] Create a separate key for Preview/local with a small limit (e.g. $10). Locally it goes in `.env.local`
      (`OPENROUTER_API_KEY=...` and `LLM_ENABLED=true`), which git ignores.
- [ ] Fund the OpenRouter account (and consider auto top-up so the key never runs dry mid-month).

## 3. Stripe (live mode)

- [ ] Create the Pro product with a **$39/month** recurring price, and note the price id for `STRIPE_PRICE_PRO`.
- [ ] Configure and save the Customer Portal settings in live mode. The "Manage billing" button won't work until a portal
      configuration exists.
- [ ] Add a webhook endpoint at `https://subtubes.com/api/stripe/webhook` with these events:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Copy that endpoint's signing secret for `STRIPE_WEBHOOK_SECRET`.

## 4. Vercel

- [ ] Confirm the plan supports a cron running every 15 minutes and functions running up to 300 seconds (both are set in the code).
      Hobby doesn't allow either.
- Production environment variables (added 2026-10-20 unless marked otherwise):
  - [x] `OPENROUTER_API_KEY` (Production only, Sensitive)
  - [x] `LLM_ENABLED=false` for now; turn it on in step 6.
  - [x] `CRON_SECRET` (random, Sensitive)
  - [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`: still missing, add them after section 3.
  - [x] `LLM_PRICE_MULTIPLIER=2`, `LLM_PRO_PRICE_USD=39`, `LLM_PRO_ALLOWANCE_USD=20`, `LLM_FREE_MONTHLY_ALLOWANCE_USD=0`,
    `LLM_REQUIRE_ZDR=true` (these are also the defaults, but set them explicitly), and `LLM_GLOBAL_MONTHLY_CEILING_USD`
- [x] Make sure `STRIPE_API_BASE` and `OPENROUTER_BASE_URL` are **not** set. They exist only to point tests at fakes.
- [ ] Give Preview its own Stripe test-mode keys, its own OpenRouter key and its own database. Don't share production's.

## 5. Database

- [ ] Take a Supabase backup.
- [x] Run `npm run db:migrate` with `DATABASE_MIGRATION_URL` pointing at production. It only adds new tables.
      Done 2026-10-20: `20261022000000_llm_service` applied (via the session pooler, port 5432).
- [ ] Confirm Supabase's Data API is still disabled (Supabase dashboard → Project Settings → Data API). The new tables, like the
      existing `user` and `session` tables, have no row-level security and the default `anon`/`authenticated` grants, so if
      the Data API is on, anyone with the public anon key could read them, including API-key hashes and billing data.

## 6. Deploy and roll out

1. [x] Push and merge `edgar/openrouter` (on `origin/main`).
2. [x] Run `vercel deploy --prod`. The project has no Git connection, so a push alone won't deploy it. Deploy from a clean
       `git archive main` export so local `.env*` files are never uploaded. Done 2026-10-20 (`dpl_B9JUJkhxDjYWWkc9ENPCY8ikA7jP`),
       with AI off.
3. [ ] With AI still off, check that the AI usage, API keys and Billing pages load. Buy $5 of credits on a real card and confirm
       they appear. Subscribe, cancel in the portal, and confirm the plan changes both times.
4. [ ] Set `LLM_ENABLED=true` and redeploy, or only enable it for your own team first. Then:
   - [ ] create a key;
   - [ ] make one normal call and one streaming call;
   - [ ] check that the charge on the AI usage page matches OpenRouter's activity log;
   - [ ] confirm the cron job runs.
5. [ ] Refund the test payments in Stripe. Refunds don't remove credits yet, so also subtract the credits by hand in `llmAccount`.

## 7. Known gaps (ship with them, or fix first)

- Refunds and disputes don't remove credits.
- Usage warnings show only on the dashboard; there are no emails.
- If two subscriptions are ever started anyway, the duplicate is only logged. You'd have to cancel and refund it in Stripe.
- The desktop app hasn't been updated to use the new keys.
- Rate limiting covers only the AI and billing routes, not the pull-request reports API.
- Watch Vercel logs for "Recording LLM usage failed" and "Duplicate Stripe subscription" for the first few weeks.

## Emergency off switch

To shut the AI service off instantly, set `LLM_ENABLED=false` and redeploy. Billing pages keep working.
