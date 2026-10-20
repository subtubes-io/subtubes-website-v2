import { db } from "@/lib/db/client";
import { llmConfig } from "./config";
import { enabledModelIds } from "./models";
import { periodOf, periodResetsAt } from "./money";

export interface AccountRow {
  creditMicros: string | number;
  monthlyLimitMicros: string | number | null;
  enabledModels: string[] | null;
  freeAllowanceMicros: string | number | null;
  planId: string;
  planStatus: string | null;
  subscriptionAllowanceMicros: string | number;
}

// `past_due` keeps the allowance while Stripe retries the payment (the grace period); `unpaid` or `canceled` ends it.
const ACTIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due"]);

export function hasActiveSubscription(account: Pick<AccountRow, "planId" | "planStatus"> | undefined): boolean {
  return Boolean(account && account.planId !== "free" && account.planStatus && ACTIVE_SUBSCRIPTION.has(account.planStatus));
}

/** The monthly allowance included with the organization's plan: the subscription's while it is paid for, otherwise the free one. */
export function allowanceMicros(account: AccountRow | undefined): number {
  if (account && hasActiveSubscription(account)) return Number(account.subscriptionAllowanceMicros);
  if (account?.freeAllowanceMicros !== null && account?.freeAllowanceMicros !== undefined) return Number(account.freeAllowanceMicros);
  return llmConfig.freeMonthlyAllowanceMicros();
}

export async function getAccount(organizationId: string) {
  return db.selectFrom("llmAccount").selectAll().where("organizationId", "=", organizationId).executeTakeFirst();
}

export async function ensureAccount(organizationId: string) {
  await db.insertInto("llmAccount").values({ organizationId }).onConflict((oc) => oc.column("organizationId").doNothing()).execute();
}

export async function getMemberLimit(organizationId: string, userId: string) {
  return db
    .selectFrom("llmMemberLimit")
    .select(["monthlyLimitMicros", "disabled"])
    .where("organizationId", "=", organizationId)
    .where("userId", "=", userId)
    .executeTakeFirst();
}

export async function updateOrganizationSettings(input: {
  organizationId: string;
  updatedBy: string;
  monthlyLimitMicros?: number | null;
  enabledModels?: string[];
}) {
  await ensureAccount(input.organizationId);
  const set: { updatedBy: string; updatedAt: Date; monthlyLimitMicros?: number | null; enabledModels?: string[] } = {
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  if (input.monthlyLimitMicros !== undefined) set.monthlyLimitMicros = input.monthlyLimitMicros;
  if (input.enabledModels !== undefined) set.enabledModels = input.enabledModels;
  await db.updateTable("llmAccount").set(set).where("organizationId", "=", input.organizationId).execute();
}

export async function updateMemberLimit(input: {
  organizationId: string;
  userId: string;
  updatedBy: string;
  monthlyLimitMicros: number | null;
  disabled: boolean;
}) {
  await db
    .insertInto("llmMemberLimit")
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      monthlyLimitMicros: input.monthlyLimitMicros,
      disabled: input.disabled,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .onConflict((oc) => oc.columns(["organizationId", "userId"]).doUpdateSet({
      monthlyLimitMicros: input.monthlyLimitMicros,
      disabled: input.disabled,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    }))
    .execute();
}

export interface UsageSummary {
  period: string;
  resetsAt: string;
  organization: {
    spentMicros: number;
    reservedMicros: number;
    limitMicros: number | null;
    allowanceMicros: number;
    allowanceUsedMicros: number;
    creditMicros: number;
    /** Money that can still be spent this month: allowance left plus credits, minus what is in flight. */
    fundsAvailableMicros: number;
    requestCount: number;
  };
  member: { spentMicros: number; reservedMicros: number; limitMicros: number | null; disabled: boolean; requestCount: number } | null;
  /** The limit that will refuse first and what is left under it. */
  tightest: { scope: "organization" | "member" | "funds"; remainingMicros: number; limitMicros: number };
  /** 80 = at least 80% of the tightest limit is used, 100 = it is used up. */
  warning: 80 | 100 | null;
  enabledModels: string[];
  plan: { id: string; status: string | null; subscribed: boolean };
}

export async function usageSummary(organizationId: string, userId: string | null, now = new Date()): Promise<UsageSummary> {
  const period = periodOf(now);
  const [account, orgPeriod, memberPeriod, memberLimit] = await Promise.all([
    getAccount(organizationId),
    db.selectFrom("llmOrgPeriod").selectAll().where("organizationId", "=", organizationId).where("period", "=", period).executeTakeFirst(),
    userId
      ? db.selectFrom("llmMemberPeriod").selectAll().where("organizationId", "=", organizationId).where("userId", "=", userId)
        .where("period", "=", period).executeTakeFirst()
      : undefined,
    userId ? getMemberLimit(organizationId, userId) : undefined,
  ]);

  const allowance = allowanceMicros(account);
  const spent = Number(orgPeriod?.spentMicros ?? 0);
  const reserved = Number(orgPeriod?.reservedMicros ?? 0);
  const allowanceUsed = Number(orgPeriod?.allowanceUsedMicros ?? 0);
  const credit = Number(account?.creditMicros ?? 0);
  const limit = account?.monthlyLimitMicros === null || account?.monthlyLimitMicros === undefined ? null : Number(account.monthlyLimitMicros);
  const fundsAvailable = Math.max(0, Math.max(0, allowance - allowanceUsed) + credit - reserved);

  const candidates: UsageSummary["tightest"][] = [
    { scope: "funds", remainingMicros: fundsAvailable, limitMicros: allowance + credit + Math.max(0, spent - allowanceUsed) },
  ];
  if (limit !== null) candidates.push({ scope: "organization", remainingMicros: Math.max(0, limit - spent - reserved), limitMicros: limit });

  let member: UsageSummary["member"] = null;
  if (userId) {
    const memberLimitMicros = memberLimit?.monthlyLimitMicros === null || memberLimit?.monthlyLimitMicros === undefined
      ? null : Number(memberLimit.monthlyLimitMicros);
    member = {
      spentMicros: Number(memberPeriod?.spentMicros ?? 0),
      reservedMicros: Number(memberPeriod?.reservedMicros ?? 0),
      limitMicros: memberLimitMicros,
      disabled: memberLimit?.disabled ?? false,
      requestCount: memberPeriod?.requestCount ?? 0,
    };
    if (memberLimitMicros !== null) {
      candidates.push({
        scope: "member",
        remainingMicros: Math.max(0, memberLimitMicros - member.spentMicros - member.reservedMicros),
        limitMicros: memberLimitMicros,
      });
    }
  }
  const tightest = candidates.reduce((a, b) => (b.remainingMicros < a.remainingMicros ? b : a));
  const usedShare = tightest.limitMicros > 0 ? 1 - tightest.remainingMicros / tightest.limitMicros : 1;
  const warning = tightest.remainingMicros <= 0 ? 100 : usedShare >= 0.8 ? 80 : null;

  return {
    period,
    resetsAt: periodResetsAt(period).toISOString(),
    organization: {
      spentMicros: spent,
      reservedMicros: reserved,
      limitMicros: limit,
      allowanceMicros: allowance,
      allowanceUsedMicros: allowanceUsed,
      creditMicros: credit,
      fundsAvailableMicros: fundsAvailable,
      requestCount: orgPeriod?.requestCount ?? 0,
    },
    member,
    tightest,
    warning,
    enabledModels: enabledModelIds(account?.enabledModels),
    plan: { id: account?.planId ?? "free", status: account?.planStatus ?? null, subscribed: hasActiveSubscription(account) },
  };
}
