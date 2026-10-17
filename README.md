# subtubes

Next.js (App Router), TypeScript, Tailwind CSS, PostgreSQL with Kysely, and
[Better Auth](https://www.better-auth.com). The app provides accounts,
organizations, memberships/invitations, profiles, and desktop device sign-in.
Blob storage is retained for avatars and future application features.

## Local development

```bash
cp .env.example .env.local
npm install
npm run db:up
npm run db:migrate
npm run dev
```

PostgreSQL runs in Docker on localhost:5455. Fill in `BETTER_AUTH_SECRET`
(`openssl rand -base64 32`) and optional GitHub OAuth credentials privately.
GitHub's local callback is `http://localhost:3000/api/auth/callback/github`.
`npm run db:down` stops PostgreSQL without deleting data. `npm run db:reset`
permanently deletes the local database volume; never use it against production.

Migrations run separately from builds. Existing databases containing retired
content require the controlled cleanup below before `npm run db:migrate`.
Fresh databases apply the historical migrations and then retire the old schema.
Historical migration logic is preserved; the old hash helper is now located
under `migrations/helpers` so migration replay does not depend on removed app code.

## Accounts and organizations

- Email/password and username sign-in, optional GitHub OAuth, sessions, bearer
  authentication, and desktop device authorization remain supported.
- Passwords are 10–128 characters, hashed with scrypt. Usernames are 3–30
  letters, numbers, underscores, or dots. GitHub sign-in does not merge into
  an unverified password account.
- Email verification, password reset, and invitation email delivery are not
  configured. Invitation links must be shared manually.
- New users receive a personal workspace. It cannot be left, directly deleted,
  or shared with additional members; deleting the account removes it.
- Team organizations retain role-based membership and invitation controls.
  Owners/admins can invite members/admins and cancel invitations; members
  cannot manage invitations. Workspace requests validate explicit organization
  membership rather than relying on the session's active organization.
- Organization slugs use lowercase ASCII letters/digits and single hyphens,
  up to 48 characters, without leading/trailing hyphens.
- The header provides Account, Profile, Organizations, and Sign out. Theme
  controls persist light/dark preference.
- Profiles retain avatars and editable X, LinkedIn, GitHub, and Hugging Face
  links. Links accept HTTPS URLs on the matching platform; tracking parameters
  and fragments are removed.
- Avatar uploads use authenticated, same-origin `POST /api/profile/avatar`.
  Images are validated/re-encoded to 256px WebP; the limit is 2 MiB and
  16 megapixels. Missing storage configuration returns an explicit error.
- `PUT /api/profile/links` updates only the signed-in user's links.

See [desktop sign-in integration](docs/desktop-api-integration.md) for the
retained device flow and `/api/v1/me` contract.

## Storage

Keep `@vercel/blob`, both existing Blob stores, and server-only credentials.
`BLOB_READ_WRITE_TOKEN` powers public avatar uploads. The private store retains
its legacy `REPORT_BLOB_READ_WRITE_TOKEN` configuration for cleanup and future
reuse; it does not enable any product upload/sync endpoints. Never expose
read-write tokens in browser/desktop code.

The generic organization-scoped `blob` table remains available, without a
generic upload API. Reports, snapshots, designs, design versions, and their
upload-intent table are retired. Avatar files and unrelated private blobs must
not be deleted.

## Production deployment

Production: <https://subtubes.com> (also <https://www.subtubes.com>).
Vercel project: `iosubtubes-projects/subtubes-remote`; alias:
<https://subtubes-remote.vercel.app>. Supabase PostgreSQL is in `us-west-2`,
with Vercel functions in `sfo1`. Supabase hosts the database only, not auth.
Pushes to the connected production branch trigger deployment.

Disable Supabase's Data API: auth/session tables in `public` must not be exposed
through REST/GraphQL. Better Auth permissions do not protect that API.
Use the transaction pooler for `DATABASE_URL` and a direct or session-pooler
connection for `DATABASE_MIGRATION_URL`. Require `sslmode=verify-full`; where
needed set `DATABASE_SSL_CA` to the full trusted PEM certificate. Do not disable
certificate verification. The app shares a module-level pg pool with Better
Auth, limited to one connection per Vercel instance.

Server-only production configuration:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL transaction-pooler connection with verified TLS |
| `DATABASE_MIGRATION_URL` | Optional migration-only direct/session connection; otherwise uses `DATABASE_URL` |
| `DATABASE_SSL_CA` | Optional trusted PEM certificate; requires `sslmode=verify-full` |
| `BETTER_AUTH_SECRET` | Unique production authentication secret |
| `BETTER_AUTH_URL` | Canonical origin, `https://subtubes.com` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Exact additional origins, e.g. `https://www.subtubes.com,https://subtubes-remote.vercel.app` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub OAuth credentials |
| `BLOB_READ_WRITE_TOKEN` | Public avatar store credential |
| `REPORT_BLOB_READ_WRITE_TOKEN` | Retained private store credential |

Register `https://subtubes.com/api/auth/callback/github` with GitHub.
Origins must not include wildcards, paths, or trailing slashes.
Use separate databases, stores, credentials, OAuth apps, and stable auth origins
for Preview. Never run fixture-creating tests against production.

### Permanent content retirement

This deletes existing report/design content permanently. It does **not** delete
the PostgreSQL database, auth/org records, Blob stores, avatars, or unrelated
external blobs. Use a migration-capable connection to the explicitly verified
environment. Never put credentials or the inventory file in Git.

1. Validate the foundation-only app locally. Coordinate a maintenance window
   or deploy the foundation-only app before dropping tables: the old app still
   queries them. Old feature writers must not remain enabled during retirement.
2. Inventory the private store and database:

   ```bash
   npm run content:retire -- --dry-run /PRIVATE/PATH/retirement-inventory.json
   ```

3. Freeze retired database writes. This temporarily also blocks writes to the
   generic blob table, which the old app uses for these images. Auth, org,
   profile, and avatar operations remain available.

   ```bash
   CONFIRM_CONTENT_RETIREMENT=delete-reports-and-designs npm run content:retire -- --freeze
   ```

4. Wait until the command's printed safe-after timestamp. Already issued
   direct-upload tokens must expire, including tokens issued concurrently with
   freezing. Do not shorten this safety interval.
5. Execute cleanup with a private inventory output path:

   ```bash
   CONFIRM_CONTENT_RETIREMENT=delete-reports-and-designs npm run content:retire -- --execute /PRIVATE/PATH/retirement-inventory.json
   ```

   Only `report-images/` files are targeted, including known upload intents
   and orphans. Database-inline images belong to the retired feature and are
   deleted too. Other external blob rows are preserved. Failures stop cleanup;
   lookup records remain until all deletions succeed, so rerun safely.
6. Run `npm run db:migrate`. The forward migration refuses populated retirement
   without verified cleanup, drops feature tables, and removes temporary write
   guards. Empty fresh databases do not require cloud storage credentials.
7. Deploy/verify the foundation-only app. Check `/api/health`, login,
   organizations, invitations, profile/avatar, and desktop sign-in. Former
   feature endpoints return 404. Confirm auth/org counts and unrelated blobs
   were preserved. Remove private local credential files after use.

Builds never run migrations or cloud-file deletion. The retirement migration
has no restorative rollback; restoring deleted content would require a
separately retained verified backup.

## Shared UI and verification

Shared `Button`, `Input`, `FormError`, and `Table` components live in
`components/ui`. Table config is typed and supports accessible ready, empty,
loading, and error states. Organization tables remain horizontally scrollable
on small screens. Storybook uses synthetic sessions rather than live auth.

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test-layout
npm run build-storybook
npm run test-storybook
```

Integration and layout tests require a running local app and a disposable
local database. `RETIREMENT_TEST_DATABASE_URL` enables isolated migration and
cleanup tests using a private temporary schema; it explicitly rejects hosted
database URLs. Playwright uses Chromium and records named PNG attachments
in JSON results. Install missing browsers with `npx playwright install chromium`.
