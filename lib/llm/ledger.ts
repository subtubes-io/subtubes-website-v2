import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { db } from "@/lib/db/client";
import type { Database } from "@/lib/db/types";
import { llmMaxInFlight } from "@/lib/rate-limit/policy";
import { allowanceMicros } from "./account";
import { llmConfig } from "./config";
import { LlmError } from "./errors";
import { chargeFor, microsToUsd, periodOf, periodResetsAt } from "./money";

// Budget enforcement. Before a call, its worst-case cost is reserved against every limit that applies, inside one transaction that holds
// the organization's account row lock, so two concurrent requests can never both fit into the last dollar. After the call the real cost
// replaces the reservation (settle). Charges come out of the month's plan allowance first, then out of prepaid credits.

type Trx = Transaction<Database>;

export interface Reservation {
  usageId: string;
  period: string;
  estimateMicros: number;
}

export interface ReserveInput {
  organizationId: string;
  userId: string;
  apiKeyId: string;
  model: string;
  upstreamModel: string;
  stream: boolean;
  estimateMicros: number;
  estimatedInputTokens: number;
}

const usd = (micros: number) => Math.round(microsToUsd(micros) * 1_000_000) / 1_000_000;
const STALE_RESERVATION_MS = 15 * 60_000;

export async function reserve(input: ReserveInput, now = new Date()): Promise<Reservation> {
  const period = periodOf(now);
  const resetsAt = periodResetsAt(period).toISOString();
  const usageId = `gen_${randomUUID().replace(/-/g, "")}`;
  const estimate = input.estimateMicros;

  await db.transaction().execute(async (trx) => {
    await trx.insertInto("llmAccount").values({ organizationId: input.organizationId })
      .onConflict((oc) => oc.column("organizationId").doNothing()).execute();
    const account = await trx.selectFrom("llmAccount").selectAll().where("organizationId", "=", input.organizationId)
      .forUpdate().executeTakeFirstOrThrow();

    const inFlight = await trx.selectFrom("llmUsage").select((eb) => eb.fn.countAll<string>().as("n"))
      .where("userId", "=", input.userId).where("status", "=", "reserved")
      .where("createdAt", ">", new Date(now.getTime() - STALE_RESERVATION_MS)).executeTakeFirstOrThrow();
    if (Number(inFlight.n) >= llmMaxInFlight()) {
      throw new LlmError("too_many_in_flight", "Too many requests are running at once. Wait for one to finish.", { retryAfterSeconds: 2 });
    }

    const limit = await trx.selectFrom("llmMemberLimit").select(["monthlyLimitMicros", "disabled"])
      .where("organizationId", "=", input.organizationId).where("userId", "=", input.userId).executeTakeFirst();
    if (limit?.disabled) throw memberDisabled();

    await trx.insertInto("llmOrgPeriod").values({ organizationId: input.organizationId, period })
      .onConflict((oc) => oc.columns(["organizationId", "period"]).doNothing()).execute();
    await trx.insertInto("llmMemberPeriod").values({ organizationId: input.organizationId, userId: input.userId, period })
      .onConflict((oc) => oc.columns(["organizationId", "userId", "period"]).doNothing()).execute();
    const orgPeriod = await trx.selectFrom("llmOrgPeriod").selectAll()
      .where("organizationId", "=", input.organizationId).where("period", "=", period).forUpdate().executeTakeFirstOrThrow();
    const memberPeriod = await trx.selectFrom("llmMemberPeriod").selectAll()
      .where("organizationId", "=", input.organizationId).where("userId", "=", input.userId).where("period", "=", period)
      .forUpdate().executeTakeFirstOrThrow();

    if (limit?.monthlyLimitMicros !== null && limit?.monthlyLimitMicros !== undefined) {
      const cap = Number(limit.monthlyLimitMicros);
      const spent = Number(memberPeriod.spentMicros);
      if (spent + Number(memberPeriod.reservedMicros) + estimate > cap) {
        throw new LlmError("budget_exceeded",
          "Your monthly AI limit in this organization is used up. It resets on the 1st, or ask an admin to raise it.",
          { scope: "member", limitUsd: usd(cap), spentUsd: usd(spent), requiredUsd: usd(estimate), resetsAt });
      }
    }

    const orgSpent = Number(orgPeriod.spentMicros);
    const orgReserved = Number(orgPeriod.reservedMicros);
    if (account.monthlyLimitMicros !== null) {
      const cap = Number(account.monthlyLimitMicros);
      if (orgSpent + orgReserved + estimate > cap) {
        throw new LlmError("budget_exceeded",
          "The organization's monthly AI budget is used up. It resets on the 1st, or ask an admin to raise it.",
          { scope: "organization", limitUsd: usd(cap), spentUsd: usd(orgSpent), requiredUsd: usd(estimate), resetsAt });
      }
    }

    const allowanceLeft = Math.max(0, allowanceMicros(account) - Number(orgPeriod.allowanceUsedMicros));
    const available = allowanceLeft + Number(account.creditMicros) - orgReserved;
    if (estimate > available) {
      throw new LlmError("insufficient_funds",
        "The organization has no AI allowance or credits left for this request. Buy credits or subscribe on the Billing page.",
        { scope: "funds", availableUsd: usd(Math.max(0, available)), requiredUsd: usd(estimate), resetsAt });
    }

    await reserveGlobal(trx, period, estimate);

    await trx.updateTable("llmOrgPeriod").set({ reservedMicros: sql`"reservedMicros" + ${estimate}` })
      .where("organizationId", "=", input.organizationId).where("period", "=", period).execute();
    await trx.updateTable("llmMemberPeriod").set({ reservedMicros: sql`"reservedMicros" + ${estimate}` })
      .where("organizationId", "=", input.organizationId).where("userId", "=", input.userId).where("period", "=", period).execute();
    await trx.insertInto("llmUsage").values({
      id: usageId,
      organizationId: input.organizationId,
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      period,
      model: input.model,
      upstreamModel: input.upstreamModel,
      stream: input.stream,
      status: "reserved",
      estimateMicros: estimate,
      estimatedInputTokens: input.estimatedInputTokens,
      createdAt: now,
    }).execute();
  });

  return { usageId, period, estimateMicros: estimate };
}

async function reserveGlobal(trx: Trx, period: string, estimate: number) {
  await trx.insertInto("llmGlobalPeriod").values({ period }).onConflict((oc) => oc.column("period").doNothing()).execute();
  const ceiling = llmConfig.globalMonthlyCeilingMicros();
  let query = trx.updateTable("llmGlobalPeriod").set({ reservedMicros: sql`"reservedMicros" + ${estimate}` }).where("period", "=", period);
  if (ceiling > 0) query = query.where(sql<boolean>`"spentMicros" + "reservedMicros" + ${estimate} <= ${ceiling}`);
  const result = await query.executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) {
    throw new LlmError("service_unavailable", "The AI service has reached its capacity for this month. Please try again later.",
      { scope: "global" });
  }
}

export function memberDisabled() {
  return new LlmError("member_disabled", "An admin has turned off AI access for you in this organization.");
}

export interface Outcome {
  /** `settled` when the call happened (even if it failed upstream after spending), `failed` when nothing was spent. */
  status: "settled" | "failed";
  upstreamCostMicros: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  generationId?: string | null;
  upstreamStatus?: number | null;
  streamedChars?: number;
}

/** Replaces a reservation with the real cost. Idempotent: a row that is already settled or failed is left alone. */
export async function settle(usageId: string, outcome: Outcome): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const usage = await trx.selectFrom("llmUsage").selectAll().where("id", "=", usageId)
      .where("status", "in", ["reserved", "aborted"]).forUpdate().executeTakeFirst();
    if (!usage) return false;
    const account = await trx.selectFrom("llmAccount").selectAll().where("organizationId", "=", usage.organizationId)
      .forUpdate().executeTakeFirstOrThrow();
    const orgPeriod = await trx.selectFrom("llmOrgPeriod").selectAll().where("organizationId", "=", usage.organizationId)
      .where("period", "=", usage.period).forUpdate().executeTakeFirstOrThrow();

    const estimate = Number(usage.estimateMicros);
    const upstreamCost = Math.max(0, Math.ceil(outcome.upstreamCostMicros));
    const charged = chargeFor(upstreamCost, llmConfig.priceMultiplier());
    const allowanceLeft = Math.max(0, allowanceMicros(account) - Number(orgPeriod.allowanceUsedMicros));
    const fromAllowance = Math.min(charged, allowanceLeft);
    const fromCredit = charged - fromAllowance;
    const counted = outcome.status === "settled" ? 1 : 0;

    await trx.updateTable("llmOrgPeriod").set({
      reservedMicros: sql`GREATEST(0, "reservedMicros" - ${estimate})`,
      spentMicros: sql`"spentMicros" + ${charged}`,
      allowanceUsedMicros: sql`"allowanceUsedMicros" + ${fromAllowance}`,
      requestCount: sql`"requestCount" + ${counted}`,
    }).where("organizationId", "=", usage.organizationId).where("period", "=", usage.period).execute();
    if (usage.userId) {
      await trx.updateTable("llmMemberPeriod").set({
        reservedMicros: sql`GREATEST(0, "reservedMicros" - ${estimate})`,
        spentMicros: sql`"spentMicros" + ${charged}`,
        requestCount: sql`"requestCount" + ${counted}`,
      }).where("organizationId", "=", usage.organizationId).where("userId", "=", usage.userId).where("period", "=", usage.period).execute();
    }
    await trx.updateTable("llmGlobalPeriod").set({
      reservedMicros: sql`GREATEST(0, "reservedMicros" - ${estimate})`,
      spentMicros: sql`"spentMicros" + ${upstreamCost}`,
    }).where("period", "=", usage.period).execute();
    if (fromCredit > 0) {
      await trx.updateTable("llmAccount").set({ creditMicros: sql`"creditMicros" - ${fromCredit}` })
        .where("organizationId", "=", usage.organizationId).execute();
    }

    await trx.updateTable("llmUsage").set({
      status: outcome.status,
      upstreamCostMicros: upstreamCost,
      chargedMicros: charged,
      allowanceChargedMicros: fromAllowance,
      creditChargedMicros: fromCredit,
      inputTokens: outcome.inputTokens ?? usage.inputTokens,
      cachedInputTokens: outcome.cachedInputTokens ?? usage.cachedInputTokens,
      outputTokens: outcome.outputTokens ?? usage.outputTokens,
      reasoningTokens: outcome.reasoningTokens ?? usage.reasoningTokens,
      streamedChars: outcome.streamedChars ?? usage.streamedChars,
      generationId: outcome.generationId ?? usage.generationId,
      upstreamStatus: outcome.upstreamStatus ?? usage.upstreamStatus,
      settledAt: new Date(),
    }).where("id", "=", usageId).execute();
    return true;
  });
}

/**
 * A stream that ended without its usage (the client went away, or the upstream broke). The reservation is kept until the reconciliation
 * job finds the real cost at OpenRouter, so the money cannot be spent twice in the meantime.
 */
export async function markAborted(usageId: string, info: { generationId: string | null; streamedChars: number; upstreamStatus?: number | null }) {
  await db.updateTable("llmUsage").set({
    status: "aborted",
    generationId: info.generationId,
    streamedChars: info.streamedChars,
    upstreamStatus: info.upstreamStatus ?? null,
  }).where("id", "=", usageId).where("status", "=", "reserved").execute();
}
