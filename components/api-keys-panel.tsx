"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-error";
import { Table, type TableColumn } from "@/components/ui/table";
import { sendJson } from "@/components/ai-client-utils";

type ApiKey = { id: string; label: string; prefix: string; userId: string; userName: string | null; createdAt: string; lastUsedAt: string | null };

export type ApiKeysPanelConfig = {
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
  baseUrl: string;
  keys: ApiKey[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ApiKeysPanel({ config }: { config: ApiKeysPanelConfig }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = `/api/organizations/${encodeURIComponent(config.organizationId)}/ai/keys`;

  async function perform(id: string, action: () => Promise<void>) {
    setPending(id);
    setError("");
    setNotice("");
    try {
      await action();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const mine = config.keys.filter((key) => key.userId === config.currentUserId);
  const others = config.keys.filter((key) => key.userId !== config.currentUserId);
  const revoke = (key: ApiKey) => (
    <Button variant="secondary" size="compact" disabled={pending !== null} aria-label={`Revoke ${key.label}`}
      onClick={() => {
        if (!window.confirm(`Revoke "${key.label}"? Programs using it stop working at once.`)) return;
        void perform(key.id, async () => {
          await sendJson(`${base}/${encodeURIComponent(key.id)}`, "DELETE");
          setNotice(`Revoked "${key.label}".`);
        });
      }}>{pending === key.id ? "Revoking..." : "Revoke"}</Button>
  );
  const columns = (withOwner: boolean): [TableColumn<ApiKey>, ...TableColumn<ApiKey>[]] => [
    { id: "label", header: "Name", cell: (key: ApiKey) => key.label },
    ...(withOwner ? [{ id: "owner", header: "Owner", cell: (key: ApiKey) => key.userName ?? "-" }] : []),
    { id: "prefix", header: "Key", cell: (key: ApiKey) => <code>{key.prefix}…</code> },
    { id: "created", header: "Created (UTC)", cell: (key: ApiKey) => dateFormatter.format(new Date(key.createdAt)) },
    { id: "used", header: "Last used", cell: (key: ApiKey) => (key.lastUsedAt ? dateFormatter.format(new Date(key.lastUsedAt)) : "Never") },
    { id: "actions", header: "Actions", cell: revoke },
  ];

  return (
    <>
      <section className="dashboard-section" aria-labelledby="keys-create">
        <h2 id="keys-create" className="dashboard-section-title">Create a key</h2>
        <p className="dashboard-empty">
          A key calls the AI API as you, billed to this organization and counted against your limit. Use it with any OpenAI-compatible
          client: base URL <code>{config.baseUrl}</code>.
        </p>
        <form className="organization-form" onSubmit={(event) => {
          event.preventDefault();
          void perform("create", async () => {
            const result = await sendJson<{ key: string }>(base, "POST", { label: label.trim() || undefined });
            setCreated(result?.key ?? null);
            setLabel("");
          });
        }}>
          <label>
            <span className="sr-only">Key name</span>
            <Input maxLength={80} placeholder="Key name, e.g. CI pipeline" value={label} onChange={(event) => setLabel(event.target.value)} aria-label="Key name" />
          </label>
          <Button type="submit" disabled={pending !== null}>{pending === "create" ? "Creating..." : "Create key"}</Button>
        </form>
        {created && (
          <div className="ai-key-reveal" role="status">
            <p>Copy this key now. It is not shown again.</p>
            <code data-testid="new-api-key">{created}</code>
            <div className="organization-form">
              <Button variant="secondary" size="compact" onClick={() => void navigator.clipboard.writeText(created).then(() => setNotice("Key copied."))}>Copy key</Button>
              <Button variant="secondary" size="compact" onClick={() => setCreated(null)}>Done</Button>
            </div>
            <pre className="api-pre">{`curl ${config.baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${created.slice(0, 12)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "openai/gpt-6-luna", "messages": [{"role": "user", "content": "Hello"}]}'`}</pre>
          </div>
        )}
        {error && <FormError>{error}</FormError>}
        {notice && <p className="dashboard-empty" role="status">{notice}</p>}
      </section>

      <section className="dashboard-section" aria-labelledby="keys-mine">
        <h2 id="keys-mine" className="dashboard-section-title">Your keys</h2>
        <Table<ApiKey> config={{ caption: "Your API keys", columns: columns(false), rows: mine, rowKey: (key) => key.id, emptyMessage: "You have no keys in this organization." }} />
      </section>

      {config.canManage && others.length > 0 && (
        <section className="dashboard-section" aria-labelledby="keys-others">
          <h2 id="keys-others" className="dashboard-section-title">Members&apos; keys</h2>
          <Table<ApiKey> config={{ caption: "Other members' API keys", columns: columns(true), rows: others, rowKey: (key) => key.id }} />
        </section>
      )}
    </>
  );
}
