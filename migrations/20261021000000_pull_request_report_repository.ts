import { Kysely, sql } from "kysely";
import { repositoryKey } from "../lib/pull-request-reports/repository-key";

// Reports are filed under the repository they are for, so a project reads the reports of its own git remote. The key is `host/owner/repo`
// (see lib/pull-request-reports/repository-key.ts), worked out from the remote the report was published with. A report that was filed before
// reports carried a repository has none, and is not listed for any repository.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE "pullRequestReport" ADD COLUMN "repositoryKey" text`.execute(db);
  const rows = await sql<{ id: string; remote: string | null }>`
    SELECT id, repository->>'remote' AS remote FROM "pullRequestReport" WHERE repository IS NOT NULL
  `.execute(db);
  for (const { id, remote } of rows.rows) {
    const key = remote ? repositoryKey(remote) : null;
    if (key) await sql`UPDATE "pullRequestReport" SET "repositoryKey" = ${key} WHERE id = ${id}`.execute(db);
  }
  await sql`
    ALTER TABLE "pullRequestReport"
      ADD CONSTRAINT "pullRequestReport_repositoryKey_format"
      CHECK ("repositoryKey" IS NULL OR "repositoryKey" ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(/[a-z0-9][a-z0-9._~-]*){2,}$')
  `.execute(db);
  await sql`CREATE INDEX "pullRequestReport_repository" ON "pullRequestReport" ("organizationId", "repositoryKey", "createdAt" DESC, id DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "pullRequestReport_repository"`.execute(db);
  await sql`ALTER TABLE "pullRequestReport" DROP COLUMN "repositoryKey"`.execute(db);
}
