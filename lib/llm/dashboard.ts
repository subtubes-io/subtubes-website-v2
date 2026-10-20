import { sql } from "kysely";
import { isPersonalOrganization } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { usageSummary } from "./account";
import { listApiKeys } from "./keys";
import { LLM_MODELS } from "./models";
import { periodOf, previousPeriods } from "./money";

// What the organization's AI, Billing and API keys pages show. Every function expects a caller that is already a member.

export async function organizationForPage(slug: string, userId: string) {
  const organization = await db
    .selectFrom("organization")
    .innerJoin("member", "member.organizationId", "organization.id")
    .select(["organization.id", "organization.name", "organization.slug", "organization.metadata", "member.role"])
    .where("organization.slug", "=", slug)
    .where("member.userId", "=", userId)
    .executeTakeFirst();
  if (!organization) return null;
  const roles = organization.role.split(",").map((role) => role.trim());
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    personal: isPersonalOrganization(organization),
    canManage: roles.includes("owner") || roles.includes("admin"),
  };
}

export async function aiOverview(organizationId: string, userId: string) {
  const period = periodOf();
  const history = previousPeriods(6);
  const [summary, members, byModel, months] = await Promise.all([
    usageSummary(organizationId, userId),
    db.selectFrom("member")
      .innerJoin("user", "user.id", "member.userId")
      .leftJoin("llmMemberLimit", (join) => join.onRef("llmMemberLimit.organizationId", "=", "member.organizationId")
        .onRef("llmMemberLimit.userId", "=", "member.userId"))
      .leftJoin("llmMemberPeriod", (join) => join.onRef("llmMemberPeriod.organizationId", "=", "member.organizationId")
        .onRef("llmMemberPeriod.userId", "=", "member.userId").on("llmMemberPeriod.period", "=", period))
      .select([
        "member.userId", "member.role", "user.name", "user.email",
        "llmMemberLimit.monthlyLimitMicros", "llmMemberLimit.disabled",
        "llmMemberPeriod.spentMicros", "llmMemberPeriod.requestCount",
      ])
      .where("member.organizationId", "=", organizationId)
      .orderBy("member.createdAt")
      .orderBy("member.id")
      .execute(),
    db.selectFrom("llmUsage")
      .select([
        "model",
        sql<string>`count(*)`.as("requests"),
        sql<string>`coalesce(sum("chargedMicros"), 0)`.as("chargedMicros"),
        sql<string>`coalesce(sum("inputTokens"), 0)`.as("inputTokens"),
        sql<string>`coalesce(sum("cachedInputTokens"), 0)`.as("cachedInputTokens"),
        sql<string>`coalesce(sum("outputTokens"), 0)`.as("outputTokens"),
      ])
      .where("organizationId", "=", organizationId)
      .where("period", "=", period)
      .where("status", "=", "settled")
      .groupBy("model")
      .orderBy(sql`sum("chargedMicros")`, "desc")
      .execute(),
    db.selectFrom("llmOrgPeriod")
      .select(["period", "spentMicros", "requestCount"])
      .where("organizationId", "=", organizationId)
      .where("period", "in", history)
      .execute(),
  ]);

  const labels = new Map(LLM_MODELS.map((m) => [m.id, m.label]));
  const monthMap = new Map(months.map((m) => [m.period.trim(), m]));
  return {
    summary,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      limitMicros: m.monthlyLimitMicros === null ? null : Number(m.monthlyLimitMicros),
      disabled: m.disabled ?? false,
      spentMicros: Number(m.spentMicros ?? 0),
      requests: m.requestCount ?? 0,
    })),
    byModel: byModel.map((row) => ({
      model: row.model,
      label: labels.get(row.model) ?? row.model,
      requests: Number(row.requests),
      chargedMicros: Number(row.chargedMicros),
      inputTokens: Number(row.inputTokens),
      cachedInputTokens: Number(row.cachedInputTokens),
      outputTokens: Number(row.outputTokens),
    })),
    history: history.map((p) => ({
      period: p,
      spentMicros: Number(monthMap.get(p)?.spentMicros ?? 0),
      requests: monthMap.get(p)?.requestCount ?? 0,
    })),
    catalog: LLM_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      pricing: m.pricing,
      supportsImages: m.supportsImages,
      enabled: summary.enabledModels.includes(m.id),
    })),
  };
}

export async function creditTransactions(organizationId: string) {
  const rows = await db.selectFrom("llmCreditTransaction")
    .select(["id", "amountMicros", "kind", "description", "createdAt"])
    .where("organizationId", "=", organizationId)
    .orderBy("createdAt", "desc")
    .limit(20)
    .execute();
  return rows.map((row) => ({ ...row, amountMicros: Number(row.amountMicros), createdAt: row.createdAt.toISOString() }));
}

export { listApiKeys };
