import { createHash } from "node:crypto";
import { z } from "zod";
import { ReviewError } from "./errors";

export const limits = {
  manifestBytes: 524288,
  requestBytes: 589824,
  reportsPerRevision: 200,
  reportBlobBytes: 16777216,
  designBlobBytes: 33554432,
  bundleBytes: 104857600,
  blobsPerRevision: 450,
  reviewersPerReview: 50,
  orgStorageBytes: 5368709120,
  uploadUrlTtlSeconds: 300,
  downloadUrlTtlSeconds: 300,
} as const;

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const title = z.string().trim().min(1).max(300);
const branch = z.string().min(1).max(255).refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
const count = z.number().int().nonnegative().max(2147483647);
const blob = z.strictObject({ hash, bytes: z.number().int().positive().max(limits.bundleBytes) });
const reportFields = {
  clientId: z.string().min(1).max(200),
  schemaVersion: z.number().int().positive().max(2147483647),
  title, featureCount: count, issueCount: count,
  createdAt: z.iso.datetime({ offset: true }),
  blobs: z.strictObject({ report: blob, design: blob.optional() }),
};
const report = z.discriminatedUnion("kind", [
  z.strictObject({ ...reportFields, kind: z.literal("commit"), commit: sha }),
  z.strictObject({ ...reportFields, kind: z.literal("range"), range: z.strictObject({
    base: sha, head: sha, commits: z.array(sha).min(1).max(2000),
  }) }),
]);
const manifestSchema = z.strictObject({
  manifestSchemaVersion: z.literal(1),
  client: z.strictObject({ app: z.string().min(1).max(100), version: z.string().min(1).max(100) }),
  repo: z.strictObject({ key: sha, remoteUrl: z.string().max(2048).optional() }),
  review: z.strictObject({ title, sourceBranch: branch, targetBranch: branch }),
  revision: z.strictObject({ baseSha: sha, headSha: sha, commitCount: count, fileCount: count }),
  code: z.discriminatedUnion("transport", [
    z.strictObject({ transport: z.literal("remote") }),
    z.strictObject({ transport: z.literal("bundle"), bundle: blob.extend({ prerequisites: z.array(sha).max(2000) }) }),
  ]),
  reports: z.array(report).min(1).max(limits.reportsPerRevision),
});
export type Manifest = z.infer<typeof manifestSchema>;
export interface BlobClaim { hash: string; bytes: number; contentType: string }

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
export const manifestHash = (value: Manifest) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export function normalizeRemote(value: string): string {
  const converted = value.replace(/^git@([a-zA-Z0-9.-]+):(.+)$/, "https://$1/$2");
  let url: URL;
  try { url = new URL(converted); } catch { throw new ReviewError(400, "invalid_manifest", "Invalid repository URL."); }
  if (!["https:", "ssh:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ReviewError(400, "invalid_manifest", "Repository URLs must not contain credentials, query strings or fragments.");
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/+$/, "").replace(/\.git$/, "");
}

export function blobClaims(manifest: Manifest): BlobClaim[] {
  const claims: BlobClaim[] = [];
  for (const report of manifest.reports) {
    for (const role of ["report", "design"] as const) {
      const item = report.blobs[role];
      if (!item) continue;
      const maximum = role === "report" ? limits.reportBlobBytes : limits.designBlobBytes;
      if (item.bytes > maximum) throw new ReviewError(413, "too_large", `${role} payload exceeds its byte limit.`);
      claims.push({ ...item, contentType: "application/gzip" });
    }
  }
  if (manifest.code.transport === "bundle") {
    claims.push({ hash: manifest.code.bundle.hash, bytes: manifest.code.bundle.bytes, contentType: "application/x-git-bundle" });
  }
  const unique = new Map<string, BlobClaim>();
  for (const claim of claims) {
    const previous = unique.get(claim.hash);
    if (previous && (previous.bytes !== claim.bytes || previous.contentType !== claim.contentType)) {
      throw new ReviewError(400, "invalid_manifest", "A hash has conflicting size or content-type claims.");
    }
    unique.set(claim.hash, claim);
  }
  if (unique.size > limits.blobsPerRevision) throw new ReviewError(413, "too_large", "Too many blobs.");
  return [...unique.values()];
}

export function parseManifest(value: unknown): Manifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new ReviewError(400, "invalid_manifest", "Invalid review manifest.", {
    issues: parsed.error.issues.map(({ path, code }) => ({ path, code })),
  });
  const manifest = parsed.data;
  if (Buffer.byteLength(canonicalJson(manifest)) > limits.manifestBytes) throw new ReviewError(413, "too_large", "Manifest exceeds its byte limit.");
  if (manifest.revision.baseSha === manifest.revision.headSha) throw new ReviewError(400, "invalid_manifest", "Base and head must differ.");
  if (new Set(manifest.reports.map((r) => r.clientId)).size !== manifest.reports.length) {
    throw new ReviewError(400, "invalid_manifest", "Report client IDs must be unique.");
  }
  if (manifest.repo.remoteUrl) manifest.repo.remoteUrl = normalizeRemote(manifest.repo.remoteUrl);
  if (manifest.code.transport === "remote" && !manifest.repo.remoteUrl) throw new ReviewError(400, "invalid_manifest", "Remote transport requires a repository URL.");
  if (manifest.code.transport === "bundle" && process.env.REVIEWS_BUNDLES_ENABLED !== "true") {
    throw new ReviewError(403, "bundle_disabled", "Bundle uploads are disabled.");
  }
  blobClaims(manifest);
  return manifest;
}
