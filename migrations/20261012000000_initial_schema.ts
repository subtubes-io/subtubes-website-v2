import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("user")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("email", "text", (column) => column.notNull())
    .addColumn("emailVerified", "boolean", (column) =>
      column.defaultTo(false).notNull(),
    )
    .addColumn("image", "text")
    .addColumn("createdAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("username", "text")
    .addColumn("displayUsername", "text")
    .addUniqueConstraint("user_email_unique", ["email"])
    .addUniqueConstraint("user_username_unique", ["username"])
    .execute();

  await db.schema
    .createTable("session")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("expiresAt", "timestamp", (column) => column.notNull())
    .addColumn("token", "text", (column) => column.notNull())
    .addColumn("createdAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (column) => column.notNull())
    .addColumn("ipAddress", "text")
    .addColumn("userAgent", "text")
    .addColumn("userId", "text", (column) => column.notNull())
    .addColumn("activeOrganizationId", "text")
    .addUniqueConstraint("session_token_unique", ["token"])
    .addForeignKeyConstraint(
      "session_user_id_user_id_fk",
      ["userId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("account")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("accountId", "text", (column) => column.notNull())
    .addColumn("providerId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) => column.notNull())
    .addColumn("accessToken", "text")
    .addColumn("refreshToken", "text")
    .addColumn("idToken", "text")
    .addColumn("accessTokenExpiresAt", "timestamp")
    .addColumn("refreshTokenExpiresAt", "timestamp")
    .addColumn("scope", "text")
    .addColumn("password", "text")
    .addColumn("createdAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (column) => column.notNull())
    .addForeignKeyConstraint(
      "account_user_id_user_id_fk",
      ["userId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("verification")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("identifier", "text", (column) => column.notNull())
    .addColumn("value", "text", (column) => column.notNull())
    .addColumn("expiresAt", "timestamp", (column) => column.notNull())
    .addColumn("createdAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("updatedAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .execute();

  await db.schema
    .createTable("organization")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("name", "text", (column) => column.notNull())
    .addColumn("slug", "text", (column) => column.notNull())
    .addColumn("logo", "text")
    .addColumn("createdAt", "timestamp", (column) => column.notNull())
    .addColumn("metadata", "text")
    .addUniqueConstraint("organization_slug_unique", ["slug"])
    .execute();

  await db.schema
    .createTable("member")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("organizationId", "text", (column) => column.notNull())
    .addColumn("userId", "text", (column) => column.notNull())
    .addColumn("role", "text", (column) =>
      column.defaultTo("member").notNull(),
    )
    .addColumn("createdAt", "timestamp", (column) => column.notNull())
    .addForeignKeyConstraint(
      "member_organization_id_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "member_user_id_user_id_fk",
      ["userId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("invitation")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("organizationId", "text", (column) => column.notNull())
    .addColumn("email", "text", (column) => column.notNull())
    .addColumn("role", "text")
    .addColumn("status", "text", (column) =>
      column.defaultTo("pending").notNull(),
    )
    .addColumn("expiresAt", "timestamp", (column) => column.notNull())
    .addColumn("createdAt", "timestamp", (column) =>
      column.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("inviterId", "text", (column) => column.notNull())
    .addForeignKeyConstraint(
      "invitation_organization_id_organization_id_fk",
      ["organizationId"],
      "organization",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .addForeignKeyConstraint(
      "invitation_inviter_id_user_id_fk",
      ["inviterId"],
      "user",
      ["id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("deviceCode")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("deviceCode", "text", (column) => column.notNull())
    .addColumn("userCode", "text", (column) => column.notNull())
    .addColumn("userId", "text")
    .addColumn("expiresAt", "timestamp", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("lastPolledAt", "timestamp")
    .addColumn("pollingInterval", "integer")
    .addColumn("clientId", "text")
    .addColumn("scope", "text")
    .addUniqueConstraint("deviceCode_deviceCode_uidx", ["deviceCode"])
    .addUniqueConstraint("deviceCode_userCode_uidx", ["userCode"])
    .execute();

  await db.schema
    .createIndex("account_userId_idx")
    .on("account")
    .column("userId")
    .execute();
  await db.schema
    .createIndex("session_userId_idx")
    .on("session")
    .column("userId")
    .execute();
  await db.schema
    .createIndex("verification_identifier_idx")
    .on("verification")
    .column("identifier")
    .execute();
  await db.schema
    .createIndex("member_organizationId_idx")
    .on("member")
    .column("organizationId")
    .execute();
  await db.schema
    .createIndex("member_userId_idx")
    .on("member")
    .column("userId")
    .execute();
  await db.schema
    .createIndex("invitation_organizationId_idx")
    .on("invitation")
    .column("organizationId")
    .execute();
  await db.schema
    .createIndex("invitation_email_idx")
    .on("invitation")
    .column("email")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("deviceCode").execute();
  await db.schema.dropTable("invitation").execute();
  await db.schema.dropTable("member").execute();
  await db.schema.dropTable("organization").execute();
  await db.schema.dropTable("verification").execute();
  await db.schema.dropTable("account").execute();
  await db.schema.dropTable("session").execute();
  await db.schema.dropTable("user").execute();
}
