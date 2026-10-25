import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization, username } from "better-auth/plugins";
import { PostgresDialect } from "kysely";
import { pool } from "@/lib/db/client";
import { getAuthOrigins } from "@/lib/auth-origins";

export const githubConfigured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "subtubes",
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: getAuthOrigins(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: {
    dialect: new PostgresDialect({ pool }),
    type: "postgres",
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
    // Lets the desktop app call the API with an `Authorization: Bearer` session token.
    bearer(),
    // RFC 8628 device flow: the desktop app shows a code that the user approves at /device.
    deviceAuthorization({ verificationUri: "/device" }),
    // Must be last so server actions can set cookies.
    nextCookies(),
  ],
});
