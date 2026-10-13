# subtubes

The website and API behind the Subtubes IRE desktop app. Next.js (App Router), TypeScript, Tailwind CSS, Postgres with Kysely, and [Better Auth](https://www.better-auth.com) for GitHub, email and username sign-in, organizations and desktop-app sign-in.

## Local development

```bash
cp .env.example .env.local      # then fill in BETTER_AUTH_SECRET and the GitHub OAuth app values
npm install
npm run db:up                   # Postgres in Docker on localhost:5455
npm run db:migrate              # apply the Kysely migrations
npm run dev                     # http://localhost:3000
```

- To rebuild the local database from scratch, run `npm run db:reset`. This deletes the local Postgres Docker volume and all data in it before recreating the database and applying migrations.
- Generate the secret with `openssl rand -base64 32`.
- Create a GitHub OAuth app at <https://github.com/settings/developers> with homepage `http://localhost:3000` and callback `http://localhost:3000/api/auth/callback/github`, then put its client ID and secret in `.env.local`.
- `npm run db:down` stops Postgres; the data stays in the `subtubes-postgres` Docker volume.

## Deploy to Vercel with Supabase PostgreSQL

### Current production deployment

- App: <https://subtubes.com> (also <https://www.subtubes.com>)
- Vercel deployment alias: <https://subtubes-remote.vercel.app>
- Vercel project: <https://vercel.com/iosubtubes-projects/subtubes-remote>
- Supabase project: <https://supabase.com/dashboard/project/riuqrdtnpipwxgojmbsl>
- Database and function region: US West (Supabase `us-west-2`, Vercel `sfo1`).
- Dedicated production Blob store: `subtubes-remote-production`.

Production is deployed from this checkout using the Vercel CLI. To redeploy
after validating changes, run `vercel deploy --prod`. The ignored `.vercel`
directory links this checkout to the production project. Git-based automatic
deployments are not connected yet. Production secrets live in Vercel environment
settings, not in committed files. The canonical `BETTER_AUTH_URL` is
`https://subtubes.com`; `BETTER_AUTH_TRUSTED_ORIGINS` explicitly allows
`https://www.subtubes.com` and `https://subtubes-remote.vercel.app`.
Authentication and profile mutations use the same exact-origin allowlist.
GitHub OAuth must use `https://subtubes.com/api/auth/callback/github` as its
registered callback URL.

Supabase hosts PostgreSQL only. **Better Auth remains responsible for sign-in,
sessions, organizations, and desktop device authorization.** No Supabase Auth
configuration, Supabase SDK, or Supabase API keys are needed. Local development
can continue using Docker.

### 1. Create the production database

1. Create a Supabase project in a region near your Vercel functions.
2. **Disable the Data API** in the Supabase project's API settings before applying
   migrations. The app's tables are created in `public`, including account and
   session data; they must not be exposed through Supabase REST/GraphQL.
   Better Auth permissions do not protect the Supabase Data API.
3. In **Connect**, copy the **transaction pooler** connection string (port `6543`)
   for the Vercel `DATABASE_URL`. Copy a **direct connection** string for
   migrations. If your migration machine cannot reach the direct IPv6 endpoint,
   use the **session pooler** (port `5432`) instead.
4. Replace the password placeholder with your database password, percent-encoding
   reserved characters in the password. Copy the exact host and username from
   the dashboard; the pooler username differs from the direct username.
5. Require TLS and certificate verification on both hosted connections by adding
   `sslmode=verify-full` to the URL (`?sslmode=verify-full`, or
   `&sslmode=verify-full` if it already has query parameters). If the endpoint
   needs a custom CA, obtain the database certificate from Supabase and set
   `DATABASE_SSL_CA` to its full PEM content on Vercel and on the migration
   machine. This requires `sslmode=verify-full` and cannot be combined with other
   URL SSL options. Do not disable certificate verification.

The app shares a module-level `pg` pool between Kysely and Better Auth, limited
to one connection per Vercel instance (`VERCEL=1`). Kysely's queries do not use
named prepared statements, so they work with transaction pooling.

### 2. Apply migrations before deploying

From your local checkout, run the existing migrations against the new database:

```bash
DATABASE_MIGRATION_URL='YOUR_SUPABASE_DIRECT_OR_SESSION_URL_WITH_TLS' npm run db:migrate
```

Replace the placeholder privately; do not commit the URL or paste it into chat.
Alternatively, set `DATABASE_MIGRATION_URL` in your ignored `.env.local` and run
`npm run db:migrate`. It takes precedence over `DATABASE_URL` for migrations
only; leaving it empty preserves the local Docker workflow.
The migrations create a fresh schema; they do not copy existing local data.

Run migrations as a separate, controlled deployment step, **not** as part of
`npm run build`. Preview builds must never migrate the production database.
Never run `db:reset` or fixture-creating test suites against production.

### 3. Import the app into Vercel

Import the GitHub repository into Vercel, using the repository root and the
**Next.js** framework preset. Keep the default install/build settings
(`npm run build`); no `vercel.json` or Docker deployment is required.
Choose a functions region near Supabase in the Vercel project settings.

Set these environment variables for **Production** before deploying:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler URL with TLS, from step 1 |
| `DATABASE_SSL_CA` | Full PEM root certificate from Supabase when required by the endpoint |
| `BETTER_AUTH_SECRET` | A new production secret generated with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | The canonical production origin, e.g. `https://your-app.vercel.app` or your custom domain |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional comma-separated exact additional app origins, e.g. `https://www.subtubes.com`; no wildcards, paths, or trailing slashes |
| `BLOB_READ_WRITE_TOKEN` | A production Vercel Blob store token for avatar uploads |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional production GitHub OAuth app credentials |

Keep these server-only (no `NEXT_PUBLIC_` prefix). `DATABASE_MIGRATION_URL` is
only needed by the machine or CI job running migrations, not Vercel functions.
For GitHub login, register
`https://YOUR_PRODUCTION_HOST/api/auth/callback/github` as the production OAuth
callback. Email/username-and-password sign-in works without GitHub credentials.
Use a separate GitHub OAuth app for local development.

Provision a public Vercel Blob store for production and connect it to the
project. Without its token, avatar uploads return an explicit configuration
error; database-backed account features do not need Blob.

Use a **separate Supabase project/database and Blob store for Preview**, with
separate secrets and migrations. For a login-enabled preview, use a stable
preview domain and set its own `BETTER_AUTH_URL` and OAuth callback. Do not point
previews at production or add wildcard auth origins just to support changing
preview URLs.

### 4. Verify the deployment

After deploying (and after any environment-variable change, redeploy):

- Open `/api/health` and check for `status: "ok"`. This checks the app, **not**
  database connectivity.
- Create a test account, sign out, and sign back in. Confirm that the personal
  workspace loads; this exercises the database and Better Auth.
- Verify GitHub sign-in if configured, and avatar upload if Blob is configured.
- Point the desktop client at the production origin and verify device login.
- If you attach a custom domain later, update `BETTER_AUTH_URL`, the GitHub
  callback, and the desktop API origin together, then redeploy.

Reference: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

## What is here

| Path | Purpose |
|---|---|
| `/` | Home page |
| `/sign-in` | Sign in with an email or username and password, or with GitHub |
| `/sign-up` | Create an account with a name, username, email and password (or use GitHub) |
| `/dashboard` | Signed-in home: shared organizations table and organization creation |
| `/dashboard/organizations/[slug]` | Membership-checked workspace with shared members and invitations tables |
| `/invitations/[id]` | Sign in as the recipient and accept a pending invitation |
| `/dashboard/account` | Read-only account details (requires sign-in) |
| `/dashboard/profile` | Profile details and avatar upload (requires sign-in) |
| `/device` | Approves a sign-in code shown by the desktop app (OAuth device flow, RFC 8628) |
| `/api/auth/*` | Better Auth endpoints (sessions, GitHub, organizations, device flow) |
| `/api/health` | Health check |
| `/api-page` | Demo page that calls `/api/health` |

## Accounts

For desktop implementation, see the [Desktop login and report API integration
handoff](docs/desktop-api-integration.md). It documents the existing device-login
API and clearly separates the proposed, not-yet-implemented report-sharing API.

- **Email and password:** passwords are at least 10 characters and stored hashed (scrypt). Email addresses and usernames are unique; usernames are 3-30 letters, numbers, underscores or dots.
- **Username:** an account always has an email address, and people can sign in with either the email or the username.
- **GitHub:** a GitHub sign-in is never merged into an existing password account whose email is unverified. That is Better Auth's default (`requireLocalEmailVerified`) and prevents someone pre-registering another person's address.
- **Not built yet:** email verification and password reset both need an email sender (for example Resend or SES). Until one is added, `emailVerified` stays false for password accounts and there is no forgot-password flow.

The desktop app signs in with the device flow: it requests a code from `POST /api/auth/device/code`, the user approves it at `/device`, and the app polls `POST /api/auth/device/token` for a session token it then sends as `Authorization: Bearer <token>`.

## Shared UI and Storybook

Run `npm run storybook` to open the component catalog at <http://localhost:6006>.
Run `npm run build-storybook` to generate a static catalog in `storybook-static/`
(ignored by Git).
Install the test browser once with `npx playwright install chromium`, then run
`npm run test-storybook` to check all story states. The suite starts Storybook
automatically and writes a JSON report with PNG attachments to `test-results/`.

The shared `Button`, `Input`, and `FormError` components live in `components/ui/`
and are used by the account, organization, and device forms. They forward native
HTML attributes, handlers, and refs and retain the existing app CSS.
`Button` defaults to `type="button"`; explicitly use `type="submit"` in forms.
Use `size="compact"` for dense actions such as profile Save links (also `fullWidth`). It is 28px tall,
with 10px horizontal padding and 12px text; the default remains 42px tall.
Storybook includes compact primary, secondary, disabled, pending, and full-width
states. Both sizes use the same shared Button rather than page-specific sizing.
Shared inputs use a single 1px, theme-aware accent border when focused, without
an additional outline or glow. Buttons and links retain their keyboard-focus rings.

Stories alongside each component cover primary/secondary, disabled/pending,
full-width, input, error, and header states. The catalog loads the app's Tailwind
styles through Vite and uses system fonts in place of Next.js's generated Geist
fonts. Stories are isolated from Better Auth and the database: interactions test
the UI primitives without submitting requests to live authentication services.
The catalog uses Storybook's Pages Router context for these route-independent
components and `next/link`; its App Router mock is incompatible with the
installed Next.js 16 navigation internals. App Router pages and authenticated
forms are exercised in the actual app rather than rendered as stories.
Story play functions check input editing, button clicks/disabled behavior,
alert semantics, and navigation link destinations.

The common `Table` component is used for members and invitations in each
organization workspace and the dashboard's organization list. Its typed `config` supplies
a caption, columns with cell renderers, rows with stable keys, and ready/loading/
error states. Stories cover populated, empty, loading, error, and long content.
The native table keeps column headers and links accessible; a focusable scroll
region contains wide tables on mobile. Sorting, selection, and pagination are
not part of this first design.

Organization creation appears above the dashboard table. Names generate lowercase
ASCII slugs using letters, digits, and single hyphens (up to 48 characters), with
no leading/trailing hyphens. The API rejects noncanonical slugs on creation and
updates; existing organization URLs are not rewritten.

Owners and admins can create member/admin invitations, copy a recipient link,
and cancel pending invitations. Members can read the members table but cannot
view or manage invitations. Invitation creation and member queries always use
the explicit, membership-validated organization ID; navigation never calls
`setActive`. Better Auth enforces mutation permissions, recipient email, and
invitation expiry/status. Its acceptance endpoint sets the session's active
organization internally, but workspace requests never rely on that value.
Invitation emails are not configured: the UI explicitly says no email is sent
and provides links to share manually. Resend delivery is deferred.

The global header reads Better Auth's reactive session on the client. While
loading it shows a neutral account status rather than anonymous actions.
Signed-out visitors see Sign in/Get started; signed-in users see
an initials avatar with Account, Profile, Organizations, and Sign out options.
Sign out is available only inside the avatar dropdown.
The dropdown uses ordinary links with Tab navigation, Escape to close and
restore focus, and outside-click dismissal. Storybook uses `SiteHeaderView`
with synthetic session data, so it never queries live authentication services.
Account details and profile text fields remain read-only. The Profile page supports
avatar uploads; the header displays the saved image instead of initials.
Profile details appear in a compact card. Clicking the avatar opens the image
picker and selecting a valid image uploads it immediately, with visible progress
and errors. The real name and username appear beside the avatar, without a
separate Profile photo heading, instructions, or duplicate details row.
The profile card also has editable X, LinkedIn, GitHub, and Hugging Face links
with platform icons. Save links persists the URLs; clearing a field removes it.
The compact card uses icon-only rows to the left of each input, with hidden
accessible platform labels.
Only HTTPS URLs on the matching platform domain are accepted; tracking query
parameters and fragments are removed. Saved links open in a new tab.
Run `npm run db:migrate` locally and during deployment to create the
`profileLinks` table. Its rows are tied to user IDs and deleted with the account.
The authenticated, same-origin `PUT /api/profile/links` endpoint edits only the
current user's links; no Blob storage credentials are required.

### Avatar storage

Create two **public** Vercel Blob stores: one for Development/Preview and one for
Production. Set `BLOB_READ_WRITE_TOKEN` to the development store token in
`.env.local` and Vercel Development/Preview, and to the production store token only
in Vercel Production. The same server-only variable selects the appropriate store;
there is no browser-side environment selector and no fallback between stores.
Never use a `NEXT_PUBLIC_` prefix or commit the token. Restart local development
after setting it.

Authenticated, same-origin uploads go through `POST /api/profile/avatar`.
PNG/JPEG/WebP inputs are limited to 2 MB and 16 megapixels, decoded and re-encoded
as a metadata-stripped 256px square WebP before storage. SVG and animations are
not supported. The existing Better Auth user image field stores the resulting
public URL; no database migration is needed. Missing storage configuration gives
a visible error rather than pretending to save.

Images are public to anyone with the URL. Successful replacements retain older
blobs (including potentially shared URLs); lifecycle cleanup is not implemented.
If saving the profile fails, the new blob is deleted where possible and cleanup
failures are logged. Uploads require a valid session and matching website Origin.

## Page layouts

The global header includes a pill-shaped toggle with Lucide React sun/moon icons
and a sliding selected-mode indicator for signed-in and anonymous
visitors. Dark remains the default. The preference is stored in this browser,
applied before hydration on reload, and synchronized between tabs. Both themes
cover forms, tables, navigation, and landing-page content. If browser storage is
blocked, switching still works for the current page and a visible error explains
that the preference could not be saved.

Dashboard, organization, and API pages use a fluid workspace container with no
maximum width. Shared responsive gutters align the content with the site header
(18px on small screens, scaling up to 56px on desktop). Authentication cards and
the landing page retain their compact form and reading widths.
Workspace pages, including Account and Profile, use title-only page headings:
24px titles (22px on mobile) and 24px top spacing (20px on mobile), without
kickers, subtitles, or bottom borders. Header actions remain available.
The API page also omits its kicker. Global navigation and authentication layouts
are unchanged.

Run `npm run test-layout` against the local development database to verify
workspace widths at 390px, 1440px, and 1920px, mobile overflow, and sign-in card
widths, plus session-aware navigation, logout errors, and login/logout transitions.
The organization suite also covers members/invitations tables, acceptance,
cancellation, cross-organization isolation, and denied requests.
The suite creates a synthetic account and organization, removes only
those fixtures afterward, and writes JSON results with PNG attachments to
`test-results/`. Do not run it against a production database.

## Database changes

### Diagram versions and preferred cloud copy

Diagram sync does not merge documents. Each accepted push saves an immutable
version under one design ID. A server-controlled preferred-version pointer selects
the working copy. Pushes based on the current head become preferred automatically;
stale pushes are saved as candidates without replacing the leader. Owners may
elect any retained version using an atomic head-generation check.

The API supports cloud discovery, preferred/historical downloads, paginated
history, and retry-safe uploads. See the [desktop version contract](docs/desktop-api-integration.md#54-diagram-versions-and-preferred-working-copy)
for request/response shapes and winner-selection behavior. Desktop controls and
local sync checkpoints are **not implemented by this website**.

**Breaking change:** the old `PUT /designs/:designId` upload is removed. Clients
must use `POST /designs/:designId/versions` and `PUT /designs/:designId/preferred`.
This is a backend change awaiting a coordinated migration/deployment, not a claim
that the currently deployed cloud already uses this contract.

Before deploying the versioning change:

1. Back up the database and test the migration on a development copy.
2. Pause diagram writes and coordinate the desktop API cutover. The migration
   moves existing design content into a first immutable version and removes the
   old mutable document columns; old code cannot write after that migration.
3. Apply `npm run db:migrate` separately using the migration connection, then
   deploy the new server and upgraded desktop clients. Migration backfill runs
   transactionally; assess its lock duration for the actual database size.
4. Verify existing documents, owners, preferred pointers, hashes, and blob refs
   survived. Previously overwritten content cannot be reconstructed.

All accepted versions are retained without pruning. Account/organization deletion
still cascades their data. The versioning migration deliberately refuses a
destructive `down`; use a verified backup restoration or a forward migration for
rollback, preserving any versions created after the cutover.

Run `npx tsx --test tests/design-versions.test.ts` for the real-PostgreSQL suite.
It requires the local Docker database, creates a unique isolated schema, exercises
migration/API/concurrent push/election behavior, and removes only that schema.
It refuses remote database hosts.

Database types live in `lib/db/types.ts`; query the database through the Kysely instance exported from `lib/db/client.ts`. Better Auth uses the same Postgres connection pool.

Add a timestamp-prefixed TypeScript migration in `migrations/`, exporting `up` and `down` functions that accept `Kysely<unknown>`, then run `npm run db:migrate`. Migrations are applied in alphabetical order by Kysely's migrator.

The initial Kysely migration creates the database schema from scratch.
`npm run db:reset` replaces the prior Drizzle-managed **local Docker database**
with the Kysely schema; it is not a production migration or reset workflow.

## Notes

- `middleware.ts` follows the starter convention. Next.js 16 deprecates it in favor of `proxy.ts`; rename it with `npx @next/codemod@latest middleware-to-proxy .` when convenient.
- Pin Better Auth when upgrading and re-run `npx auth generate` to catch schema changes.
