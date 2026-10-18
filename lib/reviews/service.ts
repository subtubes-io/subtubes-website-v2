import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../db/types";
import { ReviewError, notFound } from "./errors";
import { blobClaims, limits, manifestHash, parseManifest } from "./manifest";
import { ReviewStorageError, type ReviewStorage } from "./storage";
import type { ReviewSnapshot, ReviewTable, RevisionTable } from "./types";

type Db = Kysely<Database>;
type Tx = Transaction<Database>;
export interface ReviewUser { id: string; name: string }
const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const reviewersSchema = z.array(idSchema).max(limits.reviewersPerReview).default([]);
const pushSchema = z.object({
  organizationId: idSchema, manifest: z.unknown(), reviewerUserIds: reviewersSchema,
  cycle: z.string().uuid().optional(),
});
const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  status: z.enum(["open", "closed", "merged"]).optional(),
  addReviewerUserIds: reviewersSchema, removeReviewerUserIds: reviewersSchema,
});
const nowPlus = (seconds: number) => new Date(Date.now() + seconds * 1000);
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export function validateId(value: string): string {
  if (!idSchema.safeParse(value).success) throw new ReviewError(400, "invalid_request", "Invalid resource ID.");
  return value;
}
export function revisionNumber(value: string): number {
  if (!/^[1-9][0-9]{0,8}$/.test(value)) throw new ReviewError(400, "invalid_request", "Invalid revision number.");
  return Number(value);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ReviewError(400, "invalid_request", "Invalid request body.");
  return result.data;
}

export class Reviews {
  constructor(private readonly db: Db, private readonly storage: ReviewStorage) {}

  private async membership(db: Db, userId: string, orgId: string, lock = false) {
    validateId(orgId);
    let query = db.selectFrom("member").select(["id", "role"]).where("organizationId", "=", orgId).where("userId", "=", userId);
    if (lock) query = query.forShare();
    const member = await query.executeTakeFirst();
    if (!member) throw notFound();
    return member;
  }

  private async transaction<T>(user: ReviewUser, orgId: string, action: (tx: Tx, member: { id: string; role: string }) => Promise<T>) {
    return this.db.transaction().execute(async (tx) => {
      // Serialize event allocation through commit, not merely nextval allocation.
      await tx.selectFrom("reviewClock").select("id").where("id", "=", true).forUpdate().executeTakeFirstOrThrow();
      await tx.selectFrom("organization").select("id").where("id", "=", orgId).forUpdate().execute();
      const member = await this.membership(tx, user.id, orgId, true);
      return action(tx, member);
    });
  }

  private async review(user: ReviewUser, reviewId: string, db = this.db) {
    validateId(reviewId);
    const review = await db.selectFrom("review").selectAll().where("id", "=", reviewId).executeTakeFirst();
    if (!review) throw notFound();
    await this.membership(db, user.id, review.organizationId);
    return review;
  }

  private author(user: ReviewUser, review: Selectable<ReviewTable>) {
    if (review.authorId !== user.id) throw new ReviewError(403, "forbidden", "Only the author can perform this operation.");
  }
  private admin(role: string) { return role.split(",").some((r) => ["owner", "admin"].includes(r.trim())); }

  async rate(user: ReviewUser, kind: string, maximum: number, seconds: number) {
    const window = String(Math.floor(Date.now() / (seconds * 1000)));
    const result = await sql<{ count: number }>`INSERT INTO "reviewRate"("userId",kind,"window",count)
      VALUES(${user.id},${kind},${window}::bigint,1)
      ON CONFLICT("userId",kind,"window") DO UPDATE SET count="reviewRate".count+1
      RETURNING count`.execute(this.db);
    if (result.rows[0].count > maximum) throw new ReviewError(429, "rate_limited", "Request rate limit exceeded.", { retryAfter: seconds });
  }

  async capabilities(user: ReviewUser, orgId?: string) {
    if (orgId) await this.membership(this.db, user.id, orgId);
    return { apiVersion: 1, manifestSchemaVersions: [1], limits,
      transports: process.env.REVIEWS_BUNDLES_ENABLED === "true" ? ["remote", "bundle"] : ["remote"],
      bundleEnabled: process.env.REVIEWS_BUNDLES_ENABLED === "true" };
  }

  async usage(user: ReviewUser, orgId: string) {
    await this.membership(this.db, user.id, orgId);
    const totals = await sql<{ stored: string; reserved: string }>`SELECT
      COALESCE(sum("byteSize") FILTER(WHERE "verifiedAt" IS NOT NULL),0)::text AS stored,
      COALESCE(sum("byteSize") FILTER(WHERE "verifiedAt" IS NULL),0)::text AS reserved
      FROM "reviewBlob" WHERE "organizationId"=${orgId}`.execute(this.db);
    const count = await this.db.selectFrom("review").select((e) => e.fn.countAll<string>().as("count"))
      .where("organizationId", "=", orgId).executeTakeFirstOrThrow();
    return { storageBytes: Number(totals.rows[0].stored), reservedBytes: Number(totals.rows[0].reserved),
      limitBytes: limits.orgStorageBytes, reviewCount: Number(count.count) };
  }

  private async addReviewers(tx: Tx, review: Selectable<ReviewTable>, users: string[]) {
    for (const userId of new Set(users)) {
      const member = await this.membership(tx, userId, review.organizationId, true);
      await tx.insertInto("reviewParticipant").values({
        reviewId: review.id, organizationId: review.organizationId, userId, memberId: member.id,
      }).onConflict((c) => c.columns(["reviewId", "userId"]).doNothing()).execute();
    }
    const count = await tx.selectFrom("reviewParticipant").select((e) => e.fn.countAll<string>().as("count"))
      .where("reviewId", "=", review.id).executeTakeFirstOrThrow();
    if (Number(count.count) > limits.reviewersPerReview) throw new ReviewError(413, "too_large", "Too many reviewers.");
  }

  async push(user: ReviewUser, value: unknown) {
    const input = parse(pushSchema, value);
    const manifest = parseManifest(input.manifest);
    const claims = blobClaims(manifest);
    const hash = manifestHash(manifest);
    const result = await this.transaction(user, input.organizationId, async (tx) => {
      const natural = {
        organizationId: input.organizationId, repoKey: manifest.repo.key,
        sourceBranch: manifest.review.sourceBranch, targetBranch: manifest.review.targetBranch,
        authorId: user.id, cycle: input.cycle ?? "",
      };
      await tx.insertInto("review").values({
        ...natural, id: id("rev"), authorName: user.name, repoRemoteUrl: manifest.repo.remoteUrl ?? null,
        title: manifest.review.title, status: "open", mergedAt: null, latestRevisionId: null,
      }).onConflict((c) => c.columns(["organizationId", "repoKey", "sourceBranch", "targetBranch", "authorId", "cycle"]).doNothing()).execute();
      let query = tx.selectFrom("review").selectAll();
      for (const key of ["organizationId", "repoKey", "sourceBranch", "targetBranch", "authorId", "cycle"] as const) {
        query = query.where(key, "=", natural[key]);
      }
      let review = await query.forUpdate().executeTakeFirstOrThrow();
      if (review.status === "merged") throw new ReviewError(409, "review_merged", "Use an explicit new cycle UUID to create a new review.");
      if (review.status === "closed") {
        review = await tx.updateTable("review").set({ status: "open", updatedAt: new Date() })
          .where("id", "=", review.id).returningAll().executeTakeFirstOrThrow();
      }
      await this.addReviewers(tx, review, input.reviewerUserIds);
      let revision = await tx.selectFrom("reviewRevision").selectAll().where("reviewId", "=", review.id)
        .where("manifestHash", "=", hash).executeTakeFirst();
      const created = !revision;
      if (!revision) {
        const previous = await tx.selectFrom("reviewRevision").select("number").where("reviewId", "=", review.id)
          .orderBy("number", "desc").executeTakeFirst();
        revision = await tx.insertInto("reviewRevision").values({
          id: id("rv"), reviewId: review.id, organizationId: review.organizationId,
          number: (previous?.number ?? 0) + 1, state: "pending", manifestHash: hash, manifest,
          expiresAt: nowPlus(86400), completedAt: null,
        }).returningAll().executeTakeFirstOrThrow();
        for (const report of manifest.reports) {
          await tx.insertInto("reviewReport").values({
            id: id("rpt"), organizationId: review.organizationId, revisionId: revision.id,
            ownerId: user.id, ownerName: user.name, clientId: report.clientId,
            kind: report.kind, title: report.title, envelope: report,
          }).execute();
        }
      }
      if (revision.state === "complete") return { review, revision, uploads: [], created };
      if (revision.state === "abandoned" || revision.expiresAt <= new Date()) {
        revision = await tx.updateTable("reviewRevision").set({ state: "pending", expiresAt: nowPlus(86400) })
          .where("id", "=", revision.id).returningAll().executeTakeFirstOrThrow();
      }
      for (const claim of claims) {
        const existing = await tx.selectFrom("reviewBlob").selectAll()
          .where("organizationId", "=", review.organizationId).where("hash", "=", claim.hash).executeTakeFirst();
        if (existing && (Number(existing.byteSize) !== claim.bytes || existing.contentType !== claim.contentType)) {
          throw new ReviewError(409, "blob_conflict", "Hash metadata conflicts with a previous upload.");
        }
        if (!existing) await tx.insertInto("reviewBlob").values({
          organizationId: review.organizationId, hash: claim.hash, byteSize: String(claim.bytes),
          contentType: claim.contentType, storagePath: null, verifiedAt: null,
        }).execute();
        await tx.insertInto("reviewRevisionBlob").values({
          revisionId: revision.id, organizationId: review.organizationId, hash: claim.hash,
        }).onConflict((c) => c.columns(["revisionId", "hash"]).doNothing()).execute();
      }
      const total = await tx.selectFrom("reviewBlob").select((e) => e.fn.sum<string>("byteSize").as("total"))
        .where("organizationId", "=", review.organizationId).executeTakeFirstOrThrow();
      if (Number(total.total) > limits.orgStorageBytes) throw new ReviewError(413, "quota_exceeded", "Organization storage quota exceeded.");
      const uploads = [];
      for (const claim of claims) {
        const stored = await tx.selectFrom("reviewBlob").select("verifiedAt")
          .where("organizationId", "=", review.organizationId).where("hash", "=", claim.hash).executeTakeFirstOrThrow();
        if (stored.verifiedAt) continue;
        let intent = await tx.selectFrom("reviewUpload").selectAll().where("revisionId", "=", revision.id)
          .where("hash", "=", claim.hash).where("ownerId", "=", user.id)
          .where("expiresAt", ">", nowPlus(30)).executeTakeFirst();
        if (!intent) {
          const issued = await sql<{ count: number }>`INSERT INTO "reviewRate"("userId",kind,"window",count)
            VALUES(${user.id},'intent',${String(Math.floor(Date.now() / 3600000))}::bigint,1)
            ON CONFLICT("userId",kind,"window") DO UPDATE SET count="reviewRate".count+1 RETURNING count`.execute(tx);
          if (issued.rows[0].count > 600) throw new ReviewError(429, "rate_limited", "Upload intent rate limit exceeded.", { retryAfter: 3600 });
          const uploadId = randomUUID();
          intent = await tx.insertInto("reviewUpload").values({
            id: uploadId, organizationId: review.organizationId, revisionId: revision.id, ownerId: user.id,
            hash: claim.hash, storagePath: `reviews/${review.organizationId}/uploads/${uploadId}/${claim.hash}`,
            expiresAt: nowPlus(limits.uploadUrlTtlSeconds),
          }).returningAll().executeTakeFirstOrThrow();
        }
        uploads.push({ ...intent, ...claim });
      }
      if (!uploads.length) {
        revision = await this.publish(tx, review, revision);
        review = await tx.selectFrom("review").selectAll().where("id", "=", review.id).executeTakeFirstOrThrow();
      }
      return { review, revision, uploads, created };
    });
    const missing = [];
    for (const upload of result.uploads) {
      await this.membership(this.db, user.id, input.organizationId);
      const target = await this.storage.mintUpload(upload.storagePath, upload.bytes, upload.contentType, upload.expiresAt);
      missing.push({ hash: upload.hash, bytes: upload.bytes, contentType: upload.contentType, upload: target });
    }
    return { created: result.created, body: { review: result.review, revision: result.revision, missing, limits } };
  }

  private async publish(tx: Tx, review: Selectable<ReviewTable>, revision: Selectable<RevisionTable>) {
    const complete = await tx.updateTable("reviewRevision").set({ state: "complete", completedAt: new Date() })
      .where("id", "=", revision.id).returningAll().executeTakeFirstOrThrow();
    const latest = await tx.selectFrom("reviewRevision").select("id").where("reviewId", "=", review.id)
      .where("state", "=", "complete").orderBy("number", "desc").executeTakeFirstOrThrow();
    await tx.updateTable("review").set({ latestRevisionId: latest.id, updatedAt: new Date() }).where("id", "=", review.id).execute();
    return complete;
  }

  async complete(user: ReviewUser, reviewId: string, number: number) {
    const review = await this.review(user, reviewId);
    this.author(user, review);
    const revision = await this.db.selectFrom("reviewRevision").selectAll().where("reviewId", "=", review.id)
      .where("number", "=", number).executeTakeFirst();
    if (!revision) throw notFound();
    if (revision.state === "complete") return { review, revision, verifying: false };
    if (revision.state !== "pending" || revision.expiresAt <= new Date()) throw new ReviewError(410, "revision_expired", "Push the manifest again to renew its upload attempt.");
    if (review.status === "merged") throw new ReviewError(409, "review_merged", "Merged reviews cannot publish revisions.");
    const claims = await this.db.selectFrom("reviewRevisionBlob as ref")
      .innerJoin("reviewBlob as blob", (j) => j.onRef("blob.organizationId", "=", "ref.organizationId").onRef("blob.hash", "=", "ref.hash"))
      .select(["blob.hash", "blob.byteSize", "blob.contentType", "blob.storagePath", "blob.verifiedAt"])
      .where("ref.revisionId", "=", revision.id).execute();
    const missing: string[] = [];
    let verifiedBytes = 0;
    let processed = 0;
    for (const claim of claims.filter((c) => !c.verifiedAt)) {
      if (processed >= 8 || (verifiedBytes > 0 && verifiedBytes + Number(claim.byteSize) > limits.bundleBytes)) break;
      processed++;
      verifiedBytes += Number(claim.byteSize);
      const intents = await this.db.selectFrom("reviewUpload").selectAll().where("revisionId", "=", revision.id)
        .where("ownerId", "=", user.id).where("hash", "=", claim.hash).orderBy("createdAt", "desc").execute();
      let winner: string | undefined;
      for (const intent of intents) {
        try {
          await this.storage.verify(intent.storagePath, claim.hash, Number(claim.byteSize), claim.contentType);
          winner = intent.storagePath;
          break;
        } catch (error) {
          if (!(error instanceof ReviewStorageError) || !["OBJECT_NOT_FOUND", "CONTENT_MISMATCH"].includes(error.code)) throw error;
        }
      }
      if (!winner) { missing.push(claim.hash); continue; }
      const path = winner;
      await this.transaction(user, review.organizationId, async (tx) => {
        const current = await this.review(user, review.id, tx);
        this.author(user, current);
        if (current.status === "merged") throw new ReviewError(409, "review_merged", "Merged reviews cannot publish revisions.");
        const active = await tx.selectFrom("reviewRevision").selectAll().where("id", "=", revision.id).executeTakeFirstOrThrow();
        if (active.state === "complete") return;
        if (active.state !== "pending" || active.expiresAt <= new Date()) throw new ReviewError(410, "revision_expired", "Upload attempt expired.");
        const intent = await tx.selectFrom("reviewUpload").select("id").where("revisionId", "=", revision.id)
          .where("storagePath", "=", path).where("ownerId", "=", user.id).executeTakeFirst();
        if (!intent) throw new ReviewError(410, "revision_expired", "Upload intent is no longer active.");
        await tx.updateTable("reviewBlob").set({ storagePath: path, verifiedAt: new Date() })
          .where("organizationId", "=", review.organizationId).where("hash", "=", claim.hash)
          .where("verifiedAt", "is", null).execute();
      });
    }
    if (missing.length) throw new ReviewError(409, "blobs_missing", "Some blobs are missing or failed verification.", { missing });
    return this.transaction(user, review.organizationId, async (tx) => {
      const current = await this.review(user, review.id, tx);
      this.author(user, current);
      const active = await tx.selectFrom("reviewRevision").selectAll().where("id", "=", revision.id).executeTakeFirstOrThrow();
      if (active.state === "complete") return { review: current, revision: active, verifying: false };
      if (current.status === "merged") throw new ReviewError(409, "review_merged", "Merged reviews cannot publish revisions.");
      if (active.state !== "pending" || active.expiresAt <= new Date()) throw new ReviewError(410, "revision_expired", "Upload attempt expired.");
      const pending = await tx.selectFrom("reviewRevisionBlob as ref")
        .innerJoin("reviewBlob as b", (j) => j.onRef("b.organizationId", "=", "ref.organizationId").onRef("b.hash", "=", "ref.hash"))
        .select("b.hash").where("ref.revisionId", "=", active.id).where("b.verifiedAt", "is", null).execute();
      if (pending.length) return { review: current, revision: active, verifying: true };
      const completed = await this.publish(tx, current, active);
      const updated = await tx.selectFrom("review").selectAll().where("id", "=", review.id).executeTakeFirstOrThrow();
      return { review: updated, revision: completed, verifying: false };
    });
  }

  async get(user: ReviewUser, reviewId: string, number?: number) {
    const review = await this.review(user, reviewId);
    const revision = number === undefined
      ? await this.db.selectFrom("reviewRevision").selectAll().where("id", "=", review.latestRevisionId ?? "").where("state", "=", "complete").executeTakeFirst()
      : await this.db.selectFrom("reviewRevision").selectAll().where("reviewId", "=", review.id).where("number", "=", number).where("state", "=", "complete").executeTakeFirst();
    if (number !== undefined && !revision) throw notFound();
    const history = await this.db.selectFrom("reviewRevision").select(["id", "number", "createdAt", "completedAt"])
      .where("reviewId", "=", review.id).where("state", "=", "complete").orderBy("number", "desc").execute();
    const reports = revision ? await this.db.selectFrom("reviewReport").selectAll().where("revisionId", "=", revision.id).execute() : [];
    const reviewers = await this.db.selectFrom("reviewParticipant").select(["userId", "lastSeenRevision"]).where("reviewId", "=", review.id).execute();
    await this.membership(this.db, user.id, review.organizationId);
    return { ...review, review, latestRevision: revision ?? null,
      ...(number === undefined ? {} : { revision }), history, reports,
      reviewers: reviewers.map((participant) => ({
        ...participant, lastSeenRevision: participant.lastSeenRevision || null,
      })) };
  }

  async members(user: ReviewUser, organizationId: string, params: URLSearchParams) {
    await this.membership(this.db, user.id, organizationId);
    const limit = params.get("limit") ?? "100";
    if (!/^[1-9][0-9]*$/.test(limit) || Number(limit) > 200) {
      throw new ReviewError(400, "invalid_request", "Member limit must be between 1 and 200.");
    }
    let boundary: { name: string; userId: string } | undefined;
    if (params.has("after")) {
      try {
        const encoded = params.get("after")!;
        if (!encoded || encoded.length > 8192) throw new Error("Invalid cursor");
        const cursor = z.object({
          version: z.literal(1), userId: z.literal(user.id), organizationId: z.literal(organizationId),
          name: z.string(), memberUserId: idSchema,
        }).parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
        boundary = { name: cursor.name, userId: cursor.memberUserId };
      } catch { throw new ReviewError(400, "invalid_cursor", "Cursor does not match this user and organization."); }
    }
    let query = this.db.selectFrom("member as m").innerJoin("user as u", "u.id", "m.userId")
      .select(["u.id as userId", "u.name", "u.username", "u.image", "m.role"])
      .where("m.organizationId", "=", organizationId);
    if (boundary) {
      const { name, userId } = boundary;
      query = query.where((e) => e.or([e("u.name", ">", name),
        e.and([e("u.name", "=", name), e("u.id", ">", userId)])]));
    }
    const rows = await query.orderBy("u.name").orderBy("u.id").limit(Number(limit) + 1).execute();
    await this.membership(this.db, user.id, organizationId);
    const hasMore = rows.length > Number(limit);
    const members = rows.slice(0, Number(limit)).map((member) => ({
      ...member, role: member.role.split(",").map((role) => role.trim()).includes("owner") ? "owner"
        : this.admin(member.role) ? "admin" : "member",
    }));
    const last = members[members.length - 1];
    return { members, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({
      version: 1, userId: user.id, organizationId, name: last.name, memberUserId: last.userId,
    })).toString("base64url") : null };
  }

  async patch(user: ReviewUser, reviewId: string, value: unknown) {
    const input = parse(patchSchema, value);
    const review = await this.review(user, reviewId);
    return this.transaction(user, review.organizationId, async (tx, member) => {
      const current = await this.review(user, review.id, tx);
      if (current.authorId !== user.id) {
        if (!this.admin(member.role) || input.title !== undefined || input.addReviewerUserIds.length || input.removeReviewerUserIds.length) {
          throw new ReviewError(403, "forbidden", "Only the author can edit title or reviewers; admins may change status.");
        }
      }
      if (current.status === "merged") throw new ReviewError(409, "review_merged", "Merged reviews are terminal.");
      if (input.removeReviewerUserIds.length) await tx.deleteFrom("reviewParticipant").where("reviewId", "=", current.id)
        .where("userId", "in", input.removeReviewerUserIds).execute();
      await this.addReviewers(tx, current, input.addReviewerUserIds);
      return tx.updateTable("review").set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.status ? { status: input.status, mergedAt: input.status === "merged" ? new Date() : null } : {}),
        updatedAt: new Date(),
      }).where("id", "=", current.id).returningAll().executeTakeFirstOrThrow();
    });
  }

  async remove(user: ReviewUser, reviewId: string) {
    const review = await this.review(user, reviewId);
    await this.transaction(user, review.organizationId, async (tx, member) => {
      const current = await this.review(user, review.id, tx);
      if (current.authorId !== user.id && !this.admin(member.role)) throw new ReviewError(403, "forbidden", "Only the author or an organization admin can delete.");
      await tx.deleteFrom("review").where("id", "=", current.id).execute();
    });
    return { deleted: true, storageCleanup: "queued" };
  }

  async seen(user: ReviewUser, reviewId: string, value: unknown) {
    const input = parse(z.object({ revision: z.number().int().positive() }), value);
    const review = await this.review(user, reviewId);
    return this.transaction(user, review.organizationId, async (tx) => {
      const revision = await tx.selectFrom("reviewRevision").select("id").where("reviewId", "=", review.id)
        .where("number", "=", input.revision).where("state", "=", "complete").executeTakeFirst();
      if (!revision) throw notFound();
      const participant = await tx.selectFrom("reviewParticipant").select("userId").where("reviewId", "=", review.id)
        .where("userId", "=", user.id).executeTakeFirst();
      if (!participant) throw new ReviewError(403, "forbidden", "Only assigned reviewers can record seen state.");
      const updated = await tx.updateTable("reviewParticipant").set({
        lastSeenRevision: sql<number>`GREATEST("lastSeenRevision",${input.revision})`,
      }).where("reviewId", "=", review.id).where("userId", "=", user.id)
        .returning("lastSeenRevision").executeTakeFirstOrThrow();
      return { seen: updated.lastSeenRevision };
    });
  }

  async download(user: ReviewUser, reviewId: string, hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ReviewError(400, "invalid_request", "Invalid hash.");
    const review = await this.review(user, reviewId);
    const blob = await this.db.selectFrom("reviewRevisionBlob as ref")
      .innerJoin("reviewRevision as rv", "rv.id", "ref.revisionId")
      .innerJoin("reviewBlob as b", (j) => j.onRef("b.organizationId", "=", "ref.organizationId").onRef("b.hash", "=", "ref.hash"))
      .select("b.storagePath").where("rv.reviewId", "=", review.id).where("rv.state", "=", "complete")
      .where("b.organizationId", "=", review.organizationId).where("b.hash", "=", hash).where("b.verifiedAt", "is not", null).executeTakeFirst();
    if (!blob?.storagePath) throw notFound();
    await this.membership(this.db, user.id, review.organizationId);
    return this.storage.mintDownload(blob.storagePath);
  }

  async list(user: ReviewUser, params: URLSearchParams) {
    const role = params.get("role") ?? "reviewer";
    const status = params.get("status") ?? "open";
    const org = params.get("organizationId");
    const limitText = params.get("limit") ?? "50";
    if (!["reviewer", "author", "all"].includes(role) || !["open", "closed", "merged", "all"].includes(status) ||
      !/^[1-9][0-9]*$/.test(limitText) || Number(limitText) > 100) throw new ReviewError(400, "invalid_request", "Invalid list filters.");
    if (org) await this.membership(this.db, user.id, org);
    const scope = { userId: user.id, role, status, organizationId: org };
    let after = "0";
    let upper: string | undefined;
    if (params.has("after")) {
      try {
        const encoded = params.get("after")!;
        if (encoded.length > 2048) throw new Error("Invalid cursor");
        const cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        const sequence = (value: unknown): value is string => typeof value === "string" &&
          /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");
        if (JSON.stringify(cursor.scope) !== JSON.stringify(scope) || !sequence(cursor.after) ||
          (cursor.upper !== undefined && !sequence(cursor.upper))) throw new Error("Invalid cursor");
        after = cursor.after; upper = cursor.upper;
      } catch { throw new ReviewError(400, "invalid_cursor", "Cursor does not match this user and query."); }
    }
    const clock = await this.db.selectFrom("reviewClock").select("value").where("id", "=", true).executeTakeFirstOrThrow();
    upper ??= clock.value;
    if (BigInt(after) > BigInt(upper) || BigInt(upper) > BigInt(clock.value)) {
      throw new ReviewError(400, "invalid_cursor", "Cursor sequence is invalid.");
    }
    let query = this.db.selectFrom("reviewChange as event")
      .selectAll("event").where("event.seq", ">", after).where("event.seq", "<=", upper)
      .where((e) => e.exists(e.selectFrom("member").select("id").whereRef("member.organizationId", "=", "event.organizationId").where("member.userId", "=", user.id)));
    if (org) query = query.where("event.organizationId", "=", org);
    const events = await query.orderBy("event.seq", "asc").limit(Number(limitText)).execute();
    const matches = (snapshot: ReviewSnapshot | null) => Boolean(snapshot?.latestRevisionId &&
      (status === "all" || snapshot.status === status) &&
      (role === "all" || (role === "author" ? snapshot.authorId === user.id : snapshot.reviewerUserIds.includes(user.id))));
    const items = [];
    for (const event of events) {
      const before = matches(event.before), afterMatches = matches(event.after);
      if (!before && !afterMatches) continue;
      await this.membership(this.db, user.id, event.organizationId);
      const present = await this.db.selectFrom("review").select("id").where("id", "=", event.reviewId).executeTakeFirst();
      if (afterMatches && present) items.push({ ...event.after, seq: event.seq, removed: false });
      else items.push({ id: event.reviewId, organizationId: event.organizationId, seq: event.seq, removed: true });
    }
    const next = events.length ? events[events.length - 1].seq : upper;
    const hasMore = events.length === Number(limitText) && BigInt(next) < BigInt(upper);
    return {
      items,
      nextCursor: Buffer.from(JSON.stringify({ scope, after: hasMore ? next : upper, ...(hasMore ? { upper } : {}) })).toString("base64url"),
      hasMore,
    };
  }
}
