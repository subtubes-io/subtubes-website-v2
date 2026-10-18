import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ApiError } from "./errors";
import { ID_PATTERN } from "./http";
import { sanitizeRemote } from "./remote";
import type { ValidatedPublish } from "./validate";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const SUMMARY_COLUMNS = [
  "pullRequestReport.id",
  "pullRequestReport.organizationId",
  "pullRequestReport.title",
  "pullRequestReport.branch",
  "pullRequestReport.baseBranch",
  "pullRequestReport.startSha",
  "pullRequestReport.headSha",
  "pullRequestReport.commitCount",
  "pullRequestReport.fileCount",
  "pullRequestReport.additions",
  "pullRequestReport.deletions",
  "pullRequestReport.authors",
  "pullRequestReport.schemaVersion",
  "pullRequestReport.clientReportId",
  "pullRequestReport.repository",
  "pullRequestReport.sizeBytes",
  "pullRequestReport.createdAt",
  "pullRequestReport.createdBy",
  "user.name as publisherName",
  "user.image as publisherImage",
] as const;

function summaries() {
  return db.selectFrom("pullRequestReport").innerJoin("user", "user.id", "pullRequestReport.createdBy").select(SUMMARY_COLUMNS);
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaries>["executeTakeFirstOrThrow"]>>;

// What anyone in the organization may see of a report. Never an email address.
export function toSummary(row: SummaryRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    branch: row.branch,
    baseBranch: row.baseBranch,
    startSha: row.startSha,
    headSha: row.headSha,
    commitCount: row.commitCount,
    fileCount: row.fileCount,
    additions: row.additions,
    deletions: row.deletions,
    authors: row.authors,
    schemaVersion: row.schemaVersion,
    clientReportId: row.clientReportId,
    repository: row.repository,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdBy, name: row.publisherName, image: row.publisherImage },
  };
}

export type ReportSummary = ReturnType<typeof toSummary>;

export async function publishReport(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  validated: ValidatedPublish;
}): Promise<{ created: boolean; report: ReportSummary }> {
  const { organizationId, userId, idempotencyKey, validated } = input;
  const { bundle, repository } = validated.request;
  const stored = repository ? { name: repository.name, remote: sanitizeRemote(repository.remote) } : null;
  const id = `rpt_${randomBytes(9).toString("base64url")}`;

  const inserted = await db
    .insertInto("pullRequestReport")
    .values({
      id,
      organizationId,
      createdBy: userId,
      // The website's clock, to the millisecond so a list cursor can name it exactly.
      createdAt: new Date(),
      idempotencyKey,
      bodySha256: validated.bodySha256,
      schemaVersion: bundle.schemaVersion,
      clientReportId: bundle.report.id,
      sizeBytes: validated.sizeBytes,
      // The summary values are the document's own, never anything a client sends beside it.
      title: bundle.report.title,
      branch: bundle.branch.name,
      baseBranch: bundle.branch.base.branch,
      startSha: bundle.branch.range.startSha,
      headSha: bundle.branch.range.headSha,
      commitCount: bundle.summary.commitCount,
      fileCount: bundle.summary.fileCount,
      additions: bundle.summary.additions,
      deletions: bundle.summary.deletions,
      authors: sql<string[]>`${JSON.stringify(bundle.summary.authors)}::jsonb`,
      repository: stored ? sql<{ name: string; remote: string | null }>`${JSON.stringify(stored)}::jsonb` : null,
      document: sql<Record<string, unknown>>`${JSON.stringify(bundle)}::jsonb`,
    })
    .onConflict((conflict) => conflict.columns(["organizationId", "createdBy", "idempotencyKey"]).doNothing())
    .returning("id")
    .executeTakeFirst();

  if (inserted) return { created: true, report: await requireSummary(organizationId, inserted.id) };

  // The key was used before, by this person in this organization: the same body is the same publish, a different one is a mistake.
  const earlier = await db
    .selectFrom("pullRequestReport")
    .where("organizationId", "=", organizationId)
    .where("createdBy", "=", userId)
    .where("idempotencyKey", "=", idempotencyKey)
    .select(["id", "bodySha256"])
    .executeTakeFirst();
  // Deleted between the two statements: the publish is new again.
  if (!earlier) return publishReport(input);
  if (earlier.bodySha256 !== validated.bodySha256) {
    throw new ApiError("idempotency-conflict", "A different report was already published with this Idempotency-Key.");
  }
  return { created: false, report: await requireSummary(organizationId, earlier.id) };
}

async function requireSummary(organizationId: string, reportId: string): Promise<ReportSummary> {
  const row = await summaries().where("pullRequestReport.organizationId", "=", organizationId).where("pullRequestReport.id", "=", reportId).executeTakeFirst();
  if (!row) throw new ApiError("report-not-found", "No such report in this organization.");
  return toSummary(row);
}

// ---- list ----

const idParam = z.string().regex(ID_PATTERN);
const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(500).optional(),
  branch: z.string().min(1).max(300).optional(),
  createdBy: idParam.optional(),
});
const cursorBody = z.strictObject({ t: z.iso.datetime(), i: idParam });

const encodeCursor = (createdAt: Date, id: string) => Buffer.from(JSON.stringify({ t: createdAt.toISOString(), i: id })).toString("base64url");

function decodeCursor(cursor: string) {
  try {
    return cursorBody.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ApiError("bad-request", "The cursor is not valid.");
  }
}

export function parseListQuery(params: URLSearchParams) {
  const input: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.length > 1) throw new ApiError("bad-request", `Send "${key}" once.`);
    input[key] = values[0];
  }
  const parsed = listQuery.safeParse(input);
  if (!parsed.success) throw new ApiError("bad-request", "The query is not valid.");
  return parsed.data;
}

export async function listReports(organizationId: string, query: ReturnType<typeof parseListQuery>) {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  let select = summaries().where("pullRequestReport.organizationId", "=", organizationId);
  if (query.branch) select = select.where("pullRequestReport.branch", "=", query.branch);
  if (query.createdBy) select = select.where("pullRequestReport.createdBy", "=", query.createdBy);
  if (query.cursor) {
    const { t, i } = decodeCursor(query.cursor);
    const at = new Date(t);
    select = select.where((eb) =>
      eb.or([
        eb("pullRequestReport.createdAt", "<", at),
        eb.and([eb("pullRequestReport.createdAt", "=", at), eb("pullRequestReport.id", "<", i)]),
      ]),
    );
  }
  const rows = await select
    .orderBy("pullRequestReport.createdAt", "desc")
    .orderBy("pullRequestReport.id", "desc")
    .limit(limit + 1)
    .execute();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    reports: page.map(toSummary),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

// ---- read and delete ----

export async function readReport(organizationId: string, reportId: string) {
  if (!ID_PATTERN.test(reportId)) throw new ApiError("bad-request", "The report id is not valid.");
  const report = await requireSummary(organizationId, reportId);
  const stored = await db
    .selectFrom("pullRequestReport")
    .where("organizationId", "=", organizationId)
    .where("id", "=", reportId)
    .select("document")
    .executeTakeFirst();
  if (!stored) throw new ApiError("report-not-found", "No such report in this organization.");
  return { report, bundle: stored.document };
}

export async function deleteReport(organizationId: string, reportId: string, caller: { userId: string; canManage: boolean }) {
  if (!ID_PATTERN.test(reportId)) throw new ApiError("bad-request", "The report id is not valid.");
  const existing = await db
    .selectFrom("pullRequestReport")
    .where("organizationId", "=", organizationId)
    .where("id", "=", reportId)
    .select("createdBy")
    .executeTakeFirst();
  if (!existing) throw new ApiError("report-not-found", "No such report in this organization.");
  if (existing.createdBy !== caller.userId && !caller.canManage) {
    throw new ApiError("forbidden", "Only the person who published a report, or an owner or admin of the organization, can delete it.");
  }
  const deleted = await db
    .deleteFrom("pullRequestReport")
    .where("organizationId", "=", organizationId)
    .where("id", "=", reportId)
    .executeTakeFirst();
  if (deleted.numDeletedRows === BigInt(0)) throw new ApiError("report-not-found", "No such report in this organization.");
}
