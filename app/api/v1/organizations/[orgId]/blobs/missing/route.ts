import {
  authenticateOrgMember,
  corsPreflightResponse,
  errorResponse,
  jsonResponse,
  normalizeSha256,
} from "@/lib/cloud-push/common";
import { db } from "@/lib/db/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const authResult = await authenticateOrgMember(request, orgId);
  if ("error" in authResult) return authResult.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(422, "invalid_document", "Malformed JSON body.");
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("hashes" in body) ||
    !Array.isArray((body as { hashes: unknown }).hashes)
  ) {
    return errorResponse(
      422,
      "invalid_document",
      "Request body must include an array of hashes."
    );
  }

  const rawHashes = (body as { hashes: string[] }).hashes;
  if (rawHashes.length === 0) {
    return jsonResponse({ missing: [] });
  }

  const hashMap = new Map<string, string>();
  for (const h of rawHashes) {
    if (typeof h === "string") {
      hashMap.set(normalizeSha256(h), h);
    }
  }

  const normalizedList = Array.from(hashMap.keys());
  const existingRows = await db
    .selectFrom("blob")
    .select("hash")
    .where("organizationId", "=", orgId)
    .where("hash", "in", normalizedList)
    .execute();

  const existingSet = new Set(existingRows.map((r) => r.hash));
  const missing: string[] = [];
  for (const [norm, orig] of hashMap.entries()) {
    if (!existingSet.has(norm)) {
      missing.push(orig);
    }
  }

  return jsonResponse({ missing });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
