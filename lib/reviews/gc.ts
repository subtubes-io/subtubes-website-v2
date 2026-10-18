import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/types";
import type { ReviewStorage } from "./storage";

export async function collectReviews(db: Kysely<Database>, storage: ReviewStorage) {
  await db.transaction().execute(async (tx) => {
    await tx.selectFrom("reviewClock").select("id").where("id", "=", true).forUpdate().execute();
    await tx.updateTable("reviewRevision").set({ state: "abandoned" }).where("state", "=", "pending").where("expiresAt", "<", new Date()).execute();
    await sql`DELETE FROM "reviewRevisionBlob" ref USING "reviewRevision" rv
      WHERE ref."revisionId"=rv.id AND rv.state='abandoned'`.execute(tx);
    // Preserve all published revisions. Only expired/unreferenced attempts are collectible.
    await sql`DELETE FROM "reviewUpload" u WHERE u."expiresAt" < now() - interval '5 minutes'
      AND (NOT EXISTS(SELECT 1 FROM "reviewRevisionBlob" ref WHERE ref."revisionId"=u."revisionId")
        OR EXISTS(SELECT 1 FROM "reviewBlob" b WHERE b."organizationId"=u."organizationId" AND b.hash=u.hash AND b."verifiedAt" IS NOT NULL))`.execute(tx);
    await sql`DELETE FROM "reviewBlob" b WHERE NOT EXISTS(
      SELECT 1 FROM "reviewRevisionBlob" ref WHERE ref."organizationId"=b."organizationId" AND ref.hash=b.hash)
      AND NOT EXISTS(SELECT 1 FROM "reviewUpload" u WHERE u."organizationId"=b."organizationId" AND u.hash=b.hash)
      AND b."createdAt" < now() - interval '48 hours'`.execute(tx);
    await sql`DELETE FROM "reviewRate" WHERE
      (kind IN ('push','intent') AND "window" < floor(extract(epoch FROM now())/3600)-48)
      OR (kind NOT IN ('push','intent') AND "window" < floor(extract(epoch FROM now())/60)-2880)`.execute(tx);
  });
  let deleted = 0;
  for (let i = 0; i < 50; i++) {
    const leaseId = randomUUID();
    const job = await db.transaction().execute(async (tx) => {
      const candidate = await tx.selectFrom("reviewGc").selectAll().where("notBefore", "<=", new Date())
        .where((e) => e.or([e("leaseUntil", "is", null), e("leaseUntil", "<", new Date())]))
        .orderBy("notBefore", "asc").forUpdate().skipLocked().executeTakeFirst();
      if (!candidate) return undefined;
      await tx.updateTable("reviewGc").set({ leaseId, leaseUntil: new Date(Date.now() + 300000), attempts: candidate.attempts + 1 })
        .where("storagePath", "=", candidate.storagePath).execute();
      return candidate;
    });
    if (!job) break;
    try {
      const referenced = await db.selectFrom("reviewBlob").select("hash").where("storagePath", "=", job.storagePath).executeTakeFirst();
      if (!referenced) {
        await storage.delete(job.storagePath);
        deleted++;
      }
      await db.deleteFrom("reviewGc").where("storagePath", "=", job.storagePath).where("leaseId", "=", leaseId).execute();
    } catch (error) {
      await db.updateTable("reviewGc").set({
        leaseId: null, leaseUntil: null, notBefore: new Date(Date.now() + Math.min(86400, 60 * 2 ** Math.min(job.attempts, 10)) * 1000),
      }).where("storagePath", "=", job.storagePath).where("leaseId", "=", leaseId).execute();
      throw error;
    }
  }
  return { deleted };
}
