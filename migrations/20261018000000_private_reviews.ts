import { Kysely, sql } from "kysely";

export async function up<T>(db: Kysely<T>): Promise<void> {
  await sql`
    ALTER TABLE member ADD CONSTRAINT review_member_scope UNIQUE(id,"organizationId","userId");
    CREATE TABLE "reviewClock" (id boolean PRIMARY KEY DEFAULT true CHECK(id), value bigint NOT NULL DEFAULT 0);
    INSERT INTO "reviewClock" (id) VALUES (true);
    CREATE TABLE review (
      id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      "authorId" text REFERENCES "user"(id) ON DELETE SET NULL, "authorName" text NOT NULL,
      "repoKey" text NOT NULL, "repoRemoteUrl" text,
      "sourceBranch" text NOT NULL, "targetBranch" text NOT NULL, title text NOT NULL,
      status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','merged')),
      "mergedAt" timestamptz, "latestRevisionId" text, cycle text NOT NULL DEFAULT '',
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE(id, "organizationId"),
      UNIQUE("organizationId","repoKey","sourceBranch","targetBranch","authorId",cycle)
    );
    CREATE TABLE "reviewRevision" (
      id text PRIMARY KEY, "reviewId" text NOT NULL, "organizationId" text NOT NULL,
      number integer NOT NULL CHECK(number > 0),
      state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','abandoned')),
      "manifestHash" text NOT NULL, manifest jsonb NOT NULL,
      "expiresAt" timestamptz NOT NULL, "completedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY("reviewId","organizationId") REFERENCES review(id,"organizationId") ON DELETE CASCADE,
      UNIQUE("reviewId",number), UNIQUE("reviewId","manifestHash"),
      UNIQUE("reviewId",id), UNIQUE(id,"organizationId")
    );
    ALTER TABLE review ADD CONSTRAINT review_latest_fk
      FOREIGN KEY(id,"latestRevisionId") REFERENCES "reviewRevision"("reviewId",id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE "reviewReport" (
      id text PRIMARY KEY, "organizationId" text NOT NULL,
      "revisionId" text NOT NULL, "ownerId" text REFERENCES "user"(id) ON DELETE SET NULL,
      "ownerName" text NOT NULL, "clientId" text NOT NULL,
      kind text NOT NULL CHECK(kind IN ('commit','range')), title text NOT NULL,
      envelope jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY("revisionId","organizationId") REFERENCES "reviewRevision"(id,"organizationId") ON DELETE CASCADE,
      UNIQUE("revisionId","clientId")
    );
    CREATE INDEX review_report_owner ON "reviewReport"("organizationId","ownerId");
    CREATE TABLE "reviewParticipant" (
      "reviewId" text NOT NULL, "organizationId" text NOT NULL,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "memberId" text NOT NULL,
      "lastSeenRevision" integer NOT NULL DEFAULT 0 CHECK("lastSeenRevision" >= 0),
      "addedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY("reviewId","userId"),
      FOREIGN KEY("memberId","organizationId","userId") REFERENCES member(id,"organizationId","userId") ON DELETE CASCADE,
      FOREIGN KEY("reviewId","organizationId") REFERENCES review(id,"organizationId") ON DELETE CASCADE
    );
    CREATE TABLE "reviewBlob" (
      "organizationId" text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
      "byteSize" bigint NOT NULL CHECK("byteSize" > 0 AND "byteSize" <= 104857600),
      "contentType" text NOT NULL CHECK("contentType" IN ('application/gzip','application/x-git-bundle')),
      "storagePath" text UNIQUE, "verifiedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY("organizationId",hash),
      CHECK (("storagePath" IS NULL) = ("verifiedAt" IS NULL))
    );
    CREATE TABLE "reviewRevisionBlob" (
      "revisionId" text NOT NULL, "organizationId" text NOT NULL, hash text NOT NULL,
      PRIMARY KEY("revisionId",hash),
      FOREIGN KEY("revisionId","organizationId") REFERENCES "reviewRevision"(id,"organizationId") ON DELETE CASCADE,
      FOREIGN KEY("organizationId",hash) REFERENCES "reviewBlob"("organizationId",hash) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE "reviewUpload" (
      id text PRIMARY KEY, "organizationId" text NOT NULL, "revisionId" text NOT NULL,
      "ownerId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, hash text NOT NULL,
      "storagePath" text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY("revisionId","organizationId") REFERENCES "reviewRevision"(id,"organizationId") ON DELETE CASCADE,
      FOREIGN KEY("organizationId",hash) REFERENCES "reviewBlob"("organizationId",hash) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TABLE "reviewChange" (
      seq bigint PRIMARY KEY, "organizationId" text NOT NULL,
      "reviewId" text NOT NULL, before jsonb, after jsonb,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "reviewGc" (
      "storagePath" text PRIMARY KEY, "notBefore" timestamptz NOT NULL,
      "leaseUntil" timestamptz, "leaseId" text, attempts integer NOT NULL DEFAULT 0
    );
    CREATE TABLE "reviewRate" (
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, kind text NOT NULL,
      "window" bigint NOT NULL, count integer NOT NULL, PRIMARY KEY("userId",kind,"window")
    );
    CREATE INDEX review_org ON review("organizationId",status);
    CREATE INDEX review_participant_user ON "reviewParticipant"("userId","reviewId");
    CREATE INDEX review_change_org ON "reviewChange"("organizationId",seq);
    CREATE INDEX review_upload_expiry ON "reviewUpload"("expiresAt");
    CREATE INDEX review_gc_due ON "reviewGc"("notBefore");
  `.execute(db);
  await sql`
    CREATE FUNCTION reviews_snapshot(value review) RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT to_jsonb(value) || jsonb_build_object('reviewerUserIds',
        COALESCE((SELECT jsonb_agg("userId" ORDER BY "userId") FROM "reviewParticipant" WHERE "reviewId"=value.id),'[]'::jsonb))
    $$;
    CREATE FUNCTION reviews_emit(org text, review_id text, old_value jsonb, new_value jsonb)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE next_seq bigint;
      BEGIN
        UPDATE "reviewClock" SET value=value+1 WHERE id RETURNING value INTO next_seq;
        INSERT INTO "reviewChange"(seq,"organizationId","reviewId",before,after)
          VALUES(next_seq,org,review_id,old_value,new_value);
      END
    $$;
    CREATE FUNCTION reviews_changed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM 1 FROM "reviewClock" WHERE id FOR UPDATE;
        IF TG_OP='DELETE' THEN
          PERFORM reviews_emit(OLD."organizationId",OLD.id,reviews_snapshot(OLD),NULL);
          RETURN OLD;
        ELSIF TG_OP='INSERT' THEN
          PERFORM reviews_emit(NEW."organizationId",NEW.id,NULL,reviews_snapshot(NEW));
        ELSE
          PERFORM reviews_emit(NEW."organizationId",NEW.id,reviews_snapshot(OLD),reviews_snapshot(NEW));
        END IF;
        RETURN NEW;
      END
    $$;
    CREATE TRIGGER reviews_changed BEFORE INSERT OR UPDATE OR DELETE ON review
      FOR EACH ROW EXECUTE FUNCTION reviews_changed();
    CREATE FUNCTION reviews_participant_changed() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE parent review; current_value jsonb; previous_value jsonb;
      BEGIN
        PERFORM 1 FROM "reviewClock" WHERE id FOR UPDATE;
        SELECT * INTO parent FROM review WHERE id=COALESCE(NEW."reviewId",OLD."reviewId");
        IF NOT FOUND THEN RETURN NULL; END IF;
        current_value := reviews_snapshot(parent);
        IF TG_OP='INSERT' THEN
          previous_value := jsonb_set(current_value,'{reviewerUserIds}',
            COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(current_value->'reviewerUserIds') x WHERE x<>NEW."userId"),'[]'::jsonb));
        ELSIF TG_OP='DELETE' THEN
          previous_value := jsonb_set(current_value,'{reviewerUserIds}',
            (current_value->'reviewerUserIds') || to_jsonb(OLD."userId"));
        ELSE
          previous_value := current_value;
        END IF;
        PERFORM reviews_emit(parent."organizationId",parent.id,previous_value,current_value);
        RETURN NULL;
      END
    $$;
    CREATE TRIGGER reviews_participant_changed AFTER INSERT OR UPDATE OR DELETE ON "reviewParticipant"
      FOR EACH ROW EXECUTE FUNCTION reviews_participant_changed();
    CREATE FUNCTION reviews_validate_participant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM member WHERE id=NEW."memberId" AND "userId"=NEW."userId" AND "organizationId"=NEW."organizationId") THEN
          RAISE EXCEPTION 'Reviewer must be an organization member';
        END IF;
        RETURN NEW;
      END
    $$;
    CREATE TRIGGER reviews_validate_participant BEFORE INSERT OR UPDATE ON "reviewParticipant"
      FOR EACH ROW EXECUTE FUNCTION reviews_validate_participant();
    CREATE FUNCTION reviews_enqueue_storage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."storagePath" IS NOT NULL THEN
          INSERT INTO "reviewGc"("storagePath","notBefore")
          VALUES(OLD."storagePath",clock_timestamp()+interval '10 minutes')
          ON CONFLICT("storagePath") DO UPDATE SET "notBefore"=GREATEST("reviewGc"."notBefore",EXCLUDED."notBefore");
        END IF;
        RETURN OLD;
      END
    $$;
    CREATE TRIGGER reviews_blob_deleted BEFORE DELETE ON "reviewBlob"
      FOR EACH ROW EXECUTE FUNCTION reviews_enqueue_storage();
    CREATE TRIGGER reviews_upload_deleted BEFORE DELETE ON "reviewUpload"
      FOR EACH ROW EXECUTE FUNCTION reviews_enqueue_storage();
  `.execute(db);
}

export async function down<T>(db: Kysely<T>): Promise<void> {
  const contents = await sql<{ count: string }>`SELECT (
    (SELECT count(*) FROM review)+(SELECT count(*) FROM "reviewBlob")+(SELECT count(*) FROM "reviewGc")
  )::text AS count`.execute(db);
  if (contents.rows[0].count !== "0") throw new Error("Cannot discard private review content or pending storage cleanup.");
  await sql`
    ALTER TABLE review DROP CONSTRAINT review_latest_fk;
    DROP FUNCTION reviews_snapshot(review);
    DROP TABLE "reviewRate","reviewUpload","reviewRevisionBlob","reviewBlob","reviewParticipant","reviewReport","reviewRevision",review,"reviewChange","reviewGc","reviewClock";
    DROP FUNCTION reviews_changed(),reviews_participant_changed(),reviews_validate_participant(),reviews_enqueue_storage();
    DROP FUNCTION reviews_emit(text,text,jsonb,jsonb);
    ALTER TABLE member DROP CONSTRAINT review_member_scope;
  `.execute(db);
}
