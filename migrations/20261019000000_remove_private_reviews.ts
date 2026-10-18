import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS "reviewReport","reviewRevisionBlob","reviewParticipant",
      "reviewUpload","reviewRevision","reviewBlob",review,"reviewChange",
      "reviewGc","reviewRate","reviewClock" CASCADE;
    DROP FUNCTION IF EXISTS reviews_changed() CASCADE;
    DROP FUNCTION IF EXISTS reviews_participant_changed() CASCADE;
    DROP FUNCTION IF EXISTS reviews_validate_participant() CASCADE;
    DROP FUNCTION IF EXISTS reviews_enqueue_storage() CASCADE;
    DROP FUNCTION IF EXISTS reviews_emit(text,text,jsonb,jsonb) CASCADE;
    ALTER TABLE IF EXISTS member DROP CONSTRAINT IF EXISTS review_member_scope;
  `.execute(db);
  await sql`
    DO $$
    BEGIN
      IF to_regclass('review') IS NOT NULL THEN
        EXECUTE 'DROP FUNCTION IF EXISTS reviews_snapshot(review) CASCADE';
      END IF;
    END
    $$;
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Private reviews were removed permanently; restoring them requires restoring the feature code and migration.");
}
