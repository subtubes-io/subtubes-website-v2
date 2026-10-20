import { Kysely, sql } from "kysely";

// The Subtubes AI service: a proxy to OpenRouter billed per organization. Money is integer micro-dollars (1 USD = 1,000,000) in bigint
// columns. Only metadata is stored (who, which model, tokens, cost); never prompts or replies.
//
// - llmAccount: one row per organization that has used or configured the service. Prepaid credits, the subscription plan from Stripe, the
//   organization's own monthly budget and which catalog models its members may use.
// - llmMemberLimit: an admin's per-member monthly cap, or a switch that turns the service off for that member.
// - llmApiKey: per-person keys scoped to one organization (`stl_...`, only the SHA-256 is kept; the key is shown once).
// - llm{Org,Member,Global}Period: this calendar month's (UTC) spend and in-flight reservations. Budget checks reserve against these in one
//   transaction so concurrent requests cannot overshoot.
// - llmUsage: the ledger, one row per request.
// - llmCreditTransaction: purchases and manual adjustments of prepaid credits.
// - stripeEvent: webhook events already handled, so a redelivery is a no-op.
// - rateLimitCounter: fixed-window counters for lib/rate-limit.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "llmAccount" (
      "organizationId" text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      "creditMicros" bigint NOT NULL DEFAULT 0,
      "monthlyLimitMicros" bigint,
      "enabledModels" text[],
      "freeAllowanceMicros" bigint,
      "planId" text NOT NULL DEFAULT 'free',
      "planStatus" text,
      "subscriptionAllowanceMicros" bigint NOT NULL DEFAULT 0,
      "stripeCustomerId" text UNIQUE,
      "stripeSubscriptionId" text UNIQUE,
      "currentPeriodEnd" timestamptz,
      "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
      "updatedBy" text REFERENCES "user"(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "llmAccount_monthlyLimit" CHECK ("monthlyLimitMicros" IS NULL OR "monthlyLimitMicros" >= 0),
      CONSTRAINT "llmAccount_freeAllowance" CHECK ("freeAllowanceMicros" IS NULL OR "freeAllowanceMicros" >= 0)
    )
  `.execute(db);

  await sql`
    CREATE TABLE "llmMemberLimit" (
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "monthlyLimitMicros" bigint,
      disabled boolean NOT NULL DEFAULT false,
      "updatedBy" text REFERENCES "user"(id) ON DELETE SET NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("organizationId", "userId"),
      CONSTRAINT "llmMemberLimit_monthlyLimit" CHECK ("monthlyLimitMicros" IS NULL OR "monthlyLimitMicros" >= 0)
    )
  `.execute(db);

  await sql`
    CREATE TABLE "llmApiKey" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "tokenHash" text NOT NULL UNIQUE,
      prefix text NOT NULL,
      label text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "lastUsedAt" timestamptz,
      "revokedAt" timestamptz
    )
  `.execute(db);
  await sql`CREATE INDEX "llmApiKey_owner" ON "llmApiKey" ("organizationId", "userId", "createdAt" DESC)`.execute(db);

  await sql`
    CREATE TABLE "llmOrgPeriod" (
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      period char(7) NOT NULL,
      "spentMicros" bigint NOT NULL DEFAULT 0,
      "reservedMicros" bigint NOT NULL DEFAULT 0,
      "allowanceUsedMicros" bigint NOT NULL DEFAULT 0,
      "requestCount" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("organizationId", period)
    )
  `.execute(db);

  await sql`
    CREATE TABLE "llmMemberPeriod" (
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "userId" text NOT NULL,
      period char(7) NOT NULL,
      "spentMicros" bigint NOT NULL DEFAULT 0,
      "reservedMicros" bigint NOT NULL DEFAULT 0,
      "requestCount" integer NOT NULL DEFAULT 0,
      PRIMARY KEY ("organizationId", "userId", period)
    )
  `.execute(db);

  await sql`
    CREATE TABLE "llmGlobalPeriod" (
      period char(7) PRIMARY KEY,
      "spentMicros" bigint NOT NULL DEFAULT 0,
      "reservedMicros" bigint NOT NULL DEFAULT 0
    )
  `.execute(db);

  await sql`
    CREATE TABLE "llmUsage" (
      id text PRIMARY KEY,
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "userId" text REFERENCES "user"(id) ON DELETE SET NULL,
      "apiKeyId" text REFERENCES "llmApiKey"(id) ON DELETE SET NULL,
      period char(7) NOT NULL,
      model text NOT NULL,
      "upstreamModel" text NOT NULL,
      stream boolean NOT NULL,
      status text NOT NULL,
      "estimateMicros" bigint NOT NULL,
      "estimatedInputTokens" integer NOT NULL,
      "inputTokens" integer NOT NULL DEFAULT 0,
      "cachedInputTokens" integer NOT NULL DEFAULT 0,
      "outputTokens" integer NOT NULL DEFAULT 0,
      "reasoningTokens" integer NOT NULL DEFAULT 0,
      "streamedChars" integer NOT NULL DEFAULT 0,
      "upstreamCostMicros" bigint,
      "chargedMicros" bigint,
      "allowanceChargedMicros" bigint,
      "creditChargedMicros" bigint,
      "generationId" text,
      "upstreamStatus" integer,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "settledAt" timestamptz,
      CONSTRAINT "llmUsage_status" CHECK (status IN ('reserved', 'settled', 'aborted', 'failed'))
    )
  `.execute(db);
  await sql`CREATE INDEX "llmUsage_org_period" ON "llmUsage" ("organizationId", period, "createdAt" DESC)`.execute(db);
  await sql`CREATE INDEX "llmUsage_open" ON "llmUsage" (status, "createdAt") WHERE status IN ('reserved', 'aborted')`.execute(db);
  await sql`CREATE INDEX "llmUsage_user_open" ON "llmUsage" ("userId") WHERE status = 'reserved'`.execute(db);

  await sql`
    CREATE TABLE "llmCreditTransaction" (
      id text PRIMARY KEY,
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "amountMicros" bigint NOT NULL,
      kind text NOT NULL,
      description text NOT NULL,
      "stripeCheckoutSessionId" text UNIQUE,
      "createdBy" text REFERENCES "user"(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "llmCreditTransaction_kind" CHECK (kind IN ('purchase', 'adjustment', 'refund'))
    )
  `.execute(db);
  await sql`CREATE INDEX "llmCreditTransaction_org" ON "llmCreditTransaction" ("organizationId", "createdAt" DESC)`.execute(db);

  await sql`
    CREATE TABLE "stripeEvent" (
      id text PRIMARY KEY,
      type text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE "rateLimitCounter" (
      key text NOT NULL,
      "windowStart" timestamptz NOT NULL,
      count integer NOT NULL,
      PRIMARY KEY (key, "windowStart")
    )
  `.execute(db);
  await sql`CREATE INDEX "rateLimitCounter_windowStart" ON "rateLimitCounter" ("windowStart")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "rateLimitCounter", "stripeEvent", "llmCreditTransaction", "llmUsage", "llmGlobalPeriod", "llmMemberPeriod", "llmOrgPeriod",
    "llmApiKey", "llmMemberLimit", "llmAccount",
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db);
  }
}
