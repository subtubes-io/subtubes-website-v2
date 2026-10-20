import { usageSummary } from "@/lib/llm/account";
import { authenticateLlm } from "@/lib/llm/auth";
import { handleLlm, NO_STORE } from "@/lib/llm/errors";
import { microsToUsd } from "@/lib/llm/money";

const usd = (micros: number) => Math.round(microsToUsd(micros) * 1_000_000) / 1_000_000;
const usdOrNull = (micros: number | null) => (micros === null ? null : usd(micros));

// This month's spend and limits for the key's organization and its owner, so a client can show what is left.
export function GET(request: Request) {
  return handleLlm(async () => {
    const caller = await authenticateLlm(request);
    const summary = await usageSummary(caller.organizationId, caller.userId);
    const org = summary.organization;
    return Response.json({
      organizationId: caller.organizationId,
      period: summary.period,
      resetsAt: summary.resetsAt,
      plan: summary.plan,
      organization: {
        spentUsd: usd(org.spentMicros),
        inFlightUsd: usd(org.reservedMicros),
        budgetUsd: usdOrNull(org.limitMicros),
        allowanceUsd: usd(org.allowanceMicros),
        allowanceUsedUsd: usd(org.allowanceUsedMicros),
        creditsUsd: usd(org.creditMicros),
        availableUsd: usd(org.fundsAvailableMicros),
        requests: org.requestCount,
      },
      member: summary.member && {
        spentUsd: usd(summary.member.spentMicros),
        inFlightUsd: usd(summary.member.reservedMicros),
        limitUsd: usdOrNull(summary.member.limitMicros),
        disabled: summary.member.disabled,
        requests: summary.member.requestCount,
      },
      tightest: { scope: summary.tightest.scope, remainingUsd: usd(summary.tightest.remainingMicros), limitUsd: usd(summary.tightest.limitMicros) },
      warning: summary.warning,
      enabledModels: summary.enabledModels,
    }, { headers: NO_STORE });
  });
}
