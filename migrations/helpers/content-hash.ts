import { createHash } from "node:crypto";

function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + keys.map((key) =>
    JSON.stringify(key) + ":" + canonicalJsonStringify((obj as Record<string, unknown>)[key])
  ).join(",") + "}";
}

export function computeCanonicalContentHash(document: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJsonStringify(document)).digest("hex")}`;
}
