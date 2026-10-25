import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Rows from before confirmation existed were never emailed, so they start unconfirmed.
  await sql`alter table "newsletterSubscriber"
    add column "token" varchar(64) not null default encode(gen_random_bytes(32), 'hex'),
    add column "confirmedAt" timestamptz,
    add column "confirmationSentAt" timestamptz not null default now()`.execute(db);
  await db.schema.createIndex("newsletterSubscriberTokenIndex").on("newsletterSubscriber").column("token").unique().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("newsletterSubscriberTokenIndex").execute();
  await sql`alter table "newsletterSubscriber" drop column "token", drop column "confirmedAt", drop column "confirmationSentAt"`.execute(db);
}
