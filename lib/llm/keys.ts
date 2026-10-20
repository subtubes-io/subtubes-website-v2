import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";

// API keys are `stl_` + 32 random bytes (base64url). Only the SHA-256 is stored; the key is shown once when it is created. A key belongs
// to one person and one organization: every call is billed to that organization and counted against that person's cap.

export const KEY_PATTERN = /^stl_[A-Za-z0-9_-]{43}$/;
export const MAX_KEYS_PER_MEMBER = 25;

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateKey(): string {
  return `stl_${randomBytes(32).toString("base64url")}`;
}

export interface ApiKeySummary {
  id: string;
  label: string;
  prefix: string;
  userId: string;
  userName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function createApiKey(input: { userId: string; organizationId: string; label: string }) {
  const key = generateKey();
  const id = `key_${randomUUID().replace(/-/g, "")}`;
  const createdAt = new Date();
  await db
    .insertInto("llmApiKey")
    .values({
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      tokenHash: hashKey(key),
      prefix: key.slice(0, 12),
      label: input.label,
      createdAt,
    })
    .execute();
  return { key, apiKey: { id, label: input.label, prefix: key.slice(0, 12), createdAt: createdAt.toISOString() } };
}

export async function countActiveKeys(userId: string, organizationId: string): Promise<number> {
  const row = await db
    .selectFrom("llmApiKey")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("userId", "=", userId)
    .where("organizationId", "=", organizationId)
    .where("revokedAt", "is", null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Active keys in an organization; only the person's own unless `all` (for admins). */
export async function listApiKeys(organizationId: string, userId: string, all: boolean): Promise<ApiKeySummary[]> {
  let query = db
    .selectFrom("llmApiKey")
    .leftJoin("user", "user.id", "llmApiKey.userId")
    .select([
      "llmApiKey.id", "llmApiKey.label", "llmApiKey.prefix", "llmApiKey.userId", "user.name as userName",
      "llmApiKey.createdAt", "llmApiKey.lastUsedAt",
    ])
    .where("llmApiKey.organizationId", "=", organizationId)
    .where("llmApiKey.revokedAt", "is", null);
  if (!all) query = query.where("llmApiKey.userId", "=", userId);
  const rows = await query.orderBy("llmApiKey.createdAt", "desc").orderBy("llmApiKey.id").execute();
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }));
}

/** Revokes a key of the organization. Returns false when there is no such active key the caller may revoke. */
export async function revokeApiKey(input: { organizationId: string; keyId: string; userId: string; canManage: boolean }) {
  let query = db
    .updateTable("llmApiKey")
    .set({ revokedAt: new Date() })
    .where("id", "=", input.keyId)
    .where("organizationId", "=", input.organizationId)
    .where("revokedAt", "is", null);
  if (!input.canManage) query = query.where("userId", "=", input.userId);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export interface KeyCaller {
  keyId: string;
  userId: string;
  organizationId: string;
  lastUsedAt: Date | null;
}

/** The active key's owner, if they are still a member of the key's organization. */
export async function findCallerByKey(key: string): Promise<KeyCaller | null> {
  if (!KEY_PATTERN.test(key)) return null;
  const row = await db
    .selectFrom("llmApiKey")
    .innerJoin("member", (join) =>
      join.onRef("member.organizationId", "=", "llmApiKey.organizationId").onRef("member.userId", "=", "llmApiKey.userId"))
    .select(["llmApiKey.id", "llmApiKey.userId", "llmApiKey.organizationId", "llmApiKey.lastUsedAt"])
    .where("llmApiKey.tokenHash", "=", hashKey(key))
    .where("llmApiKey.revokedAt", "is", null)
    .executeTakeFirst();
  return row ? { keyId: row.id, userId: row.userId, organizationId: row.organizationId, lastUsedAt: row.lastUsedAt } : null;
}

/** Records use at most every five minutes, so a busy key does not write on every call. */
export async function touchKey(caller: KeyCaller) {
  if (caller.lastUsedAt && Date.now() - caller.lastUsedAt.getTime() < 5 * 60_000) return;
  await db.updateTable("llmApiKey").set({ lastUsedAt: new Date() }).where("id", "=", caller.keyId).execute();
}

export function normalizeLabel(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "API key";
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/g, " ");
  return label.length >= 1 && label.length <= 80 ? label : null;
}
