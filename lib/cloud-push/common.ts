import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";

export const LIMITS = {
  supportedSchemaVersions: [2],
  maxReportDocumentBytes: 10 * 1024 * 1024, // 10 MiB
  maxSnapshotDocumentBytes: 10 * 1024 * 1024, // 10 MiB
  maxDesignDocumentBytes: 2 * 1024 * 1024, // 2 MiB
  maxBlobBytes: 5 * 1024 * 1024, // 5 MiB
  maxBlobsPerReport: 500,
  maxSnapshotsPerReport: 100,
  allowedBlobTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const;

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...headers,
    },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return jsonResponse(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  );
}

export function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match",
    },
  });
}

export async function authenticateOrgMember(request: Request, orgId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      error: errorResponse(401, "unauthenticated", "Token missing or expired; please sign in again."),
    };
  }

  const organization = await db
    .selectFrom("organization")
    .select(["id", "name", "slug"])
    .where("id", "=", orgId)
    .executeTakeFirst();

  if (!organization) {
    return {
      error: errorResponse(404, "not_found", "Organization not found."),
    };
  }

  const membership = await db
    .selectFrom("member")
    .select(["id", "role", "userId"])
    .where("organizationId", "=", orgId)
    .where("userId", "=", session.user.id)
    .executeTakeFirst();

  if (!membership) {
    return {
      error: errorResponse(403, "forbidden", "You are not a member of this organization."),
    };
  }

  return {
    session,
    user: session.user,
    organization,
    membership,
  };
}

export function normalizeSha256(hash: string): string {
  return hash.startsWith("sha256:") ? hash.slice(7).toLowerCase() : hash.toLowerCase();
}

export function computeSha256(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    return JSON.stringify(key) + ":" + canonicalJsonStringify((obj as Record<string, unknown>)[key]);
  });
  return "{" + pairs.join(",") + "}";
}

export function computeCanonicalContentHash(document: unknown): string {
  const canonical = canonicalJsonStringify(document);
  return `sha256:${computeSha256(canonical)}`;
}

export function containsInlineMedia(value: unknown): boolean {
  if (typeof value === "string") {
    return /^data:[a-zA-Z0-9+/-]+;base64,/i.test(value.trim()) || value.includes("data:image/");
  }
  if (Array.isArray(value)) {
    return value.some(containsInlineMedia);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsInlineMedia);
  }
  return false;
}
