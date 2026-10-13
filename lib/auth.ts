import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization, organization, username } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import { db, pool } from "@/lib/db/client";
import { isValidOrganizationSlug, normalizeOrganizationSlug } from "@/lib/organization-slug";

function validateOrganizationSlug(slug: string | undefined) {
  if (slug !== undefined && !isValidOrganizationSlug(slug)) {
    throw new APIError("BAD_REQUEST", {
      message: "Organization slug must use lowercase letters and numbers separated by single hyphens.",
    });
  }
}

export function isPersonalOrganization(org: { metadata?: string | Record<string, unknown> | null } | null | undefined): boolean {
  if (!org || !org.metadata) return false;
  if (typeof org.metadata === "object") {
    return Boolean((org.metadata as Record<string, unknown>).isPersonal || (org.metadata as Record<string, unknown>).personal);
  }
  if (typeof org.metadata === "string") {
    try {
      const parsed = JSON.parse(org.metadata);
      return Boolean(parsed.isPersonal || parsed.personal);
    } catch {
      return false;
    }
  }
  return false;
}

export async function createPersonalOrganizationForUser(user: {
  id: string;
  name?: string | null;
  username?: string | null;
}) {
  const existingMemberships = await db
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select(["organization.id", "organization.metadata"])
    .where("member.userId", "=", user.id)
    .execute();

  const alreadyHasPersonal = existingMemberships.some((m) => {
    if (!m.metadata) return false;
    try {
      const parsed = typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata;
      return parsed.isPersonal && parsed.personalUserId === user.id;
    } catch {
      return false;
    }
  });

  if (alreadyHasPersonal) return;

  const baseName = user.name?.trim() || "Personal";
  const rawBase = normalizeOrganizationSlug(user.username || baseName) || "personal";
  let slug = `${rawBase}-personal`;
  if (!isValidOrganizationSlug(slug)) {
    slug = `personal-${user.id.slice(0, 8)}`;
  }
  let attempt = 0;
  while (true) {
    const existing = await db
      .selectFrom("organization")
      .select("id")
      .where("slug", "=", slug)
      .executeTakeFirst();
    if (!existing) break;
    attempt++;
    slug = `${rawBase}-personal-${attempt}`;
  }

  const orgId = randomUUID();
  const now = new Date();
  const metadata = JSON.stringify({ isPersonal: true, personalUserId: user.id });

  await db
    .insertInto("organization")
    .values({
      id: orgId,
      name: `${baseName}'s Workspace`,
      slug,
      logo: null,
      createdAt: now,
      metadata,
    })
    .execute();

  await db
    .insertInto("member")
    .values({
      id: randomUUID(),
      organizationId: orgId,
      userId: user.id,
      role: "owner",
      createdAt: now,
    })
    .execute();
}

export async function cleanupPersonalOrganizations(userId: string) {
  const orgs = await db
    .selectFrom("organization")
    .select(["id", "metadata"])
    .execute();

  const toDelete = orgs.filter((org) => {
    if (!org.metadata) return false;
    try {
      const meta = typeof org.metadata === "string" ? JSON.parse(org.metadata) : org.metadata;
      return Boolean(meta.isPersonal && meta.personalUserId === userId);
    } catch {
      return false;
    }
  });

  if (toDelete.length > 0) {
    const ids = toDelete.map((o) => o.id);
    await db.deleteFrom("organization").where("id", "in", ids).execute();
  }
}

const personalOrgGuardPlugin = {
  id: "personal-org-guard",
  hooks: {
    before: [
      {
        matcher: (ctx: { path?: string }) => ctx.path === "/organization/leave",
        handler: async (ctx: { body?: { organizationId?: string } }) => {
          const organizationId = ctx.body?.organizationId;
          if (organizationId) {
            const org = await db
              .selectFrom("organization")
              .select(["id", "metadata"])
              .where("id", "=", organizationId)
              .executeTakeFirst();
            if (isPersonalOrganization(org)) {
              throw new APIError("BAD_REQUEST", {
                message: "You cannot leave your personal organization.",
              });
            }
          }
        },
      },
    ],
  },
};

export const githubConfigured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "subtubes",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: {
    dialect: new PostgresDialect({ pool }),
    type: "postgres",
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createPersonalOrganizationForUser(user);
        },
      },
      delete: {
        after: async (user) => {
          await cleanupPersonalOrganizations(user.id);
        },
      },
    },
  },
  user: {
    deleteUser: {
      enabled: true,
      afterDelete: async (user) => {
        await cleanupPersonalOrganizations(user.id);
      },
    },
  },
  // Email + password accounts. Passwords are hashed with scrypt by Better Auth.
  // Email verification and password reset need an email sender; add one before enabling them.
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  socialProviders: githubConfigured
    ? { github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! } }
    : {},
  plugins: [
    // Adds a unique username so people can sign in with a username or an email address.
    username(),
    personalOrgGuardPlugin,
    // Users create organizations, invite members and assign roles.
    organization({
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          validateOrganizationSlug(organization.slug);
        },
        beforeUpdateOrganization: async ({ organization }) => {
          validateOrganizationSlug(organization.slug);
        },
        beforeDeleteOrganization: async ({ organization }) => {
          if (isPersonalOrganization(organization)) {
            throw new APIError("BAD_REQUEST", {
              message: "Personal organizations cannot be deleted directly. Delete your account to remove it.",
            });
          }
        },
        beforeCreateInvitation: async ({ organization }) => {
          if (isPersonalOrganization(organization)) {
            throw new APIError("BAD_REQUEST", {
              message: "Cannot invite members to a personal organization.",
            });
          }
        },
        beforeAddMember: async ({ organization }) => {
          if (isPersonalOrganization(organization)) {
            throw new APIError("BAD_REQUEST", {
              message: "Cannot add members to a personal organization.",
            });
          }
        },
        beforeRemoveMember: async ({ organization }) => {
          if (isPersonalOrganization(organization)) {
            throw new APIError("BAD_REQUEST", {
              message: "Cannot remove members from a personal organization.",
            });
          }
        },
      },
    }),
    // Lets the desktop app call the API with an `Authorization: Bearer` session token.
    bearer(),
    // RFC 8628 device flow: the desktop app shows a code that the user approves at /device.
    deviceAuthorization({ verificationUri: "/device" }),
    // Must be last so server actions can set cookies.
    nextCookies(),
  ],
});
