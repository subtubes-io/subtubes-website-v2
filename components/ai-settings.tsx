"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Table } from "@/components/ui/table";
import { formatNumber, formatUsd, parseUsdInput, sendJson, usdInputValue } from "@/components/ai-client-utils";
import type { aiOverview } from "@/lib/llm/dashboard";

type Overview = Awaited<ReturnType<typeof aiOverview>>;
type MemberRow = Overview["members"][number];
type ModelRow = Overview["byModel"][number];
type MonthRow = Overview["history"][number];

export type AiSettingsConfig = {
  organizationId: string;
  canManage: boolean;
  personal: boolean;
  overview: Overview;
};

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (period: string) => monthFormatter.format(new Date(`${period}-01T00:00:00Z`));

export function AiSettings({ config }: { config: AiSettingsConfig }) {
  const { overview, canManage, organizationId } = config;
  const { summary } = overview;
  const org = summary.organization;
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budget, setBudget] = useState(usdInputValue(org.limitMicros));
  const [models, setModels] = useState<string[]>(summary.enabledModels);
  const [memberEdits, setMemberEdits] = useState<Record<string, { limit: string; disabled: boolean }>>({});

  async function perform(id: string, action: () => Promise<string>) {
    setPending(id);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const base = `/api/organizations/${encodeURIComponent(organizationId)}/ai`;
  // Edits are kept after saving so the field does not flash back while the page refreshes; Save is enabled only for a real change.
  const memberChanged = (row: MemberRow) => {
    const edit = memberEdits[row.userId];
    return Boolean(edit) && (parseUsdInput(edit.limit) !== (row.limitMicros === null ? null : row.limitMicros / 1_000_000) || edit.disabled !== row.disabled);
  };
  const resets = dayFormatter.format(new Date(summary.resetsAt));
  const allowanceLeft = Math.max(0, org.allowanceMicros - org.allowanceUsedMicros);
  const member = summary.member;

  return (
    <>
      {summary.warning === 100 && (
        <p className="notice" role="status">
          {summary.tightest.scope === "member"
            ? "Your monthly AI limit in this organization is used up."
            : summary.tightest.scope === "organization"
              ? "The organization's monthly AI budget is used up."
              : "There is no AI allowance or credit left."} Requests are refused until {resets}
          {summary.tightest.scope === "funds" ? " or until credits are added on the Billing page." : " or until the limit is raised."}
        </p>
      )}
      {summary.warning === 80 && (
        <p className="notice" role="status">More than 80% of {summary.tightest.scope === "member" ? "your monthly limit" : summary.tightest.scope === "organization" ? "the organization's monthly budget" : "the available AI funds"} is used.</p>
      )}

      <section className="dashboard-section" aria-labelledby="ai-month">
        <h2 id="ai-month" className="dashboard-section-title">{monthLabel(summary.period)} (resets {resets}, UTC)</h2>
        <dl className="ai-stats">
          <Stat label="Spent this month" value={formatUsd(org.spentMicros)} hint={`${formatNumber(org.requestCount)} requests`} />
          <Stat label="Monthly budget" value={org.limitMicros === null ? "No limit" : formatUsd(org.limitMicros)} />
          <Stat label="Plan allowance left" value={formatUsd(allowanceLeft)} hint={`of ${formatUsd(org.allowanceMicros)}`} />
          <Stat label="Credits" value={formatUsd(org.creditMicros)} />
          <Stat label="Available now" value={formatUsd(org.fundsAvailableMicros)} hint={org.reservedMicros > 0 ? `${formatUsd(org.reservedMicros)} in flight` : undefined} />
          {member && !config.personal && (
            <Stat label="Your spend" value={formatUsd(member.spentMicros)}
              hint={member.disabled ? "AI is turned off for you" : member.limitMicros === null ? "No personal limit" : `of ${formatUsd(member.limitMicros)}`} />
          )}
        </dl>
      </section>

      {error && <FormError>{error}</FormError>}
      {notice && <p className="dashboard-empty" role="status">{notice}</p>}

      <section className="dashboard-section" aria-labelledby="ai-budget">
        <h2 id="ai-budget" className="dashboard-section-title">Organization budget</h2>
        <p className="dashboard-empty">
          The most the organization may spend on AI in a calendar month, across all members. Leave it empty for no limit beyond the plan
          allowance and credits.
        </p>
        {canManage ? (
          <form className="organization-form" onSubmit={(event) => {
            event.preventDefault();
            const value = parseUsdInput(budget);
            if (value === undefined) {
              setError("Enter the budget in dollars, or leave it empty.");
              return;
            }
            void perform("budget", async () => {
              await sendJson(`${base}/settings`, "PUT", { monthlyLimitUsd: value });
              return value === null ? "The monthly budget was removed." : `The monthly budget is now ${formatUsd(value * 1_000_000)}.`;
            });
          }}>
            <label>
              <span className="sr-only">Monthly budget in US dollars</span>
              <Input inputMode="decimal" placeholder="No limit" value={budget} onChange={(event) => setBudget(event.target.value)} aria-label="Monthly budget in US dollars" />
            </label>
            <Button type="submit" disabled={pending !== null}>{pending === "budget" ? "Saving..." : "Save budget"}</Button>
          </form>
        ) : (
          <p className="dashboard-empty">Only owners and admins can change the budget.</p>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="ai-models">
        <h2 id="ai-models" className="dashboard-section-title">Models</h2>
        <p className="dashboard-empty">Members can use the models that are turned on. Prices are per million tokens.</p>
        <fieldset className="ai-model-list" disabled={!canManage || pending !== null}>
          <legend className="sr-only">Models members can use</legend>
          {overview.catalog.map((model) => (
            <label key={model.id} className="ai-model">
              <input type="checkbox" checked={models.includes(model.id)} onChange={(event) => setModels((current) =>
                event.target.checked ? [...current, model.id] : current.filter((id) => id !== model.id))} />
              <span className="ai-model-name">{model.label}</span>
              <span className="ai-model-meta">
                {model.provider} · <code>{model.id}</code> · in ${model.pricing.input} / out ${model.pricing.output}
              </span>
            </label>
          ))}
        </fieldset>
        {canManage && (
          <Button disabled={pending !== null} onClick={() => void perform("models", async () => {
            await sendJson(`${base}/settings`, "PUT", { enabledModels: models });
            return models.length ? `${models.length} models are turned on.` : "All models are turned off.";
          })}>{pending === "models" ? "Saving..." : "Save models"}</Button>
        )}
      </section>

      {canManage && !config.personal && (
        <section className="dashboard-section" aria-labelledby="ai-members">
          <h2 id="ai-members" className="dashboard-section-title">Members</h2>
          <p className="dashboard-empty">Give each member an optional monthly limit, or turn AI off for them.</p>
          <Table<MemberRow> config={{
            caption: "AI use by member this month",
            columns: [
              { id: "name", header: "Member", cell: (row) => <span title={row.email}>{row.name}</span> },
              { id: "spent", header: "Spent", align: "right", cell: (row) => formatUsd(row.spentMicros) },
              { id: "requests", header: "Requests", align: "right", cell: (row) => formatNumber(row.requests) },
              { id: "limit", header: "Monthly limit ($)", cell: (row) => (
                <Input className="ai-member-limit" inputMode="decimal" placeholder="No limit" aria-label={`Monthly limit for ${row.name}`}
                  value={memberEdits[row.userId]?.limit ?? usdInputValue(row.limitMicros)}
                  onChange={(event) => setMemberEdits((edits) => ({
                    ...edits, [row.userId]: { limit: event.target.value, disabled: edits[row.userId]?.disabled ?? row.disabled },
                  }))} />
              ) },
              { id: "access", header: "AI access", cell: (row) => (
                <label className="ai-toggle">
                  <input type="checkbox" checked={!(memberEdits[row.userId]?.disabled ?? row.disabled)} aria-label={`AI access for ${row.name}`}
                    onChange={(event) => setMemberEdits((edits) => ({
                      ...edits,
                      [row.userId]: { limit: edits[row.userId]?.limit ?? usdInputValue(row.limitMicros), disabled: !event.target.checked },
                    }))} />
                  {(memberEdits[row.userId]?.disabled ?? row.disabled) ? "Off" : "On"}
                </label>
              ) },
              { id: "save", header: "Actions", cell: (row) => (
                <Button variant="secondary" size="compact" disabled={pending !== null || !memberChanged(row)} onClick={() => {
                  const edit = memberEdits[row.userId];
                  const limit = parseUsdInput(edit.limit);
                  if (limit === undefined) {
                    setError(`Enter ${row.name}'s limit in dollars, or leave it empty.`);
                    return;
                  }
                  void perform(`member-${row.userId}`, async () => {
                    await sendJson(`${base}/members/${encodeURIComponent(row.userId)}`, "PUT", { monthlyLimitUsd: limit, disabled: edit.disabled });
                    return `Saved ${row.name}'s AI settings.`;
                  });
                }}>{pending === `member-${row.userId}` ? "Saving..." : "Save"}</Button>
              ) },
            ],
            rows: overview.members,
            rowKey: (row) => row.userId,
          }} />
        </section>
      )}

      <section className="dashboard-section" aria-labelledby="ai-by-model">
        <h2 id="ai-by-model" className="dashboard-section-title">By model this month</h2>
        <Table<ModelRow> config={{
          caption: "AI use by model this month",
          columns: [
            { id: "model", header: "Model", cell: (row) => row.label },
            { id: "requests", header: "Requests", align: "right", cell: (row) => formatNumber(row.requests) },
            { id: "input", header: "Input tokens", align: "right", cell: (row) => formatNumber(row.inputTokens) },
            { id: "cached", header: "Cached", align: "right", cell: (row) => formatNumber(row.cachedInputTokens) },
            { id: "output", header: "Output tokens", align: "right", cell: (row) => formatNumber(row.outputTokens) },
            { id: "cost", header: "Cost", align: "right", cell: (row) => formatUsd(row.chargedMicros) },
          ],
          rows: overview.byModel,
          rowKey: (row) => row.model,
          emptyMessage: "No AI requests this month.",
        }} />
      </section>

      <section className="dashboard-section" aria-labelledby="ai-history">
        <h2 id="ai-history" className="dashboard-section-title">Recent months</h2>
        <Table<MonthRow> config={{
          caption: "AI spend by month",
          columns: [
            { id: "month", header: "Month", cell: (row) => monthLabel(row.period) },
            { id: "requests", header: "Requests", align: "right", cell: (row) => formatNumber(row.requests) },
            { id: "spent", header: "Spent", align: "right", cell: (row) => formatUsd(row.spentMicros) },
          ],
          rows: overview.history,
          rowKey: (row) => row.period,
        }} />
      </section>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ai-stat">
      <dt>{label}</dt>
      <dd>
        <span className="ai-stat-value">{value}</span>
        {hint && <span className="ai-stat-hint">{hint}</span>}
      </dd>
    </div>
  );
}
