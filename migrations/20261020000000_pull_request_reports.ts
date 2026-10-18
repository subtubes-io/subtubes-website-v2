import { Kysely, sql } from "kysely";

// Pull-request reports published from the desktop app. A report is immutable: it is stored once, as received, with the fields the list
// needs copied into columns so listing never opens a document. Reports belong to an organization; deleting the organization or the
// publisher's account deletes them. The idempotency key is scoped to (organization, publisher), and goes with the report when it is deleted.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "pullRequestReport" (
      id text PRIMARY KEY,
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "createdBy" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL,
      "idempotencyKey" text NOT NULL,
      "bodySha256" text NOT NULL,
      "schemaVersion" integer NOT NULL,
      "clientReportId" text NOT NULL,
      "sizeBytes" integer NOT NULL,
      title text NOT NULL,
      branch text NOT NULL,
      "baseBranch" text NOT NULL,
      "startSha" text NOT NULL,
      "headSha" text NOT NULL,
      "commitCount" integer NOT NULL,
      "fileCount" integer NOT NULL,
      additions integer NOT NULL,
      deletions integer NOT NULL,
      authors jsonb NOT NULL,
      repository jsonb,
      document jsonb NOT NULL,
      CONSTRAINT "pullRequestReport_idempotency" UNIQUE ("organizationId", "createdBy", "idempotencyKey"),
      CONSTRAINT "pullRequestReport_id_format" CHECK (id ~ '^[A-Za-z0-9_-]{1,80}$'),
      CONSTRAINT "pullRequestReport_sizeBytes" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 4250000)
    )
  `.execute(db);
  await sql`CREATE INDEX "pullRequestReport_list" ON "pullRequestReport" ("organizationId", "createdAt" DESC, id DESC)`.execute(db);
  await sql`CREATE INDEX "pullRequestReport_branch" ON "pullRequestReport" ("organizationId", branch, "createdAt" DESC, id DESC)`.execute(db);
  await sql`CREATE INDEX "pullRequestReport_createdBy" ON "pullRequestReport" ("organizationId", "createdBy", "createdAt" DESC, id DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("pullRequestReport").execute();
}
