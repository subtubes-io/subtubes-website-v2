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

Database types live in `lib/db/types.ts`; query the database through the Kysely instance exported from `lib/db/client.ts`. Better Auth uses the same Postgres connection pool.

Add a timestamp-prefixed TypeScript migration in `migrations/`, exporting `up` and `down` functions that accept `Kysely<unknown>`, then run `npm run db:migrate`. Migrations are applied in alphabetical order by Kysely's migrator.

The initial Kysely migration creates the database schema from scratch. Since this app is currently local-only, `npm run db:reset` is the way to replace the prior Drizzle-managed local database with the Kysely schema.

## Notes

- `middleware.ts` follows the starter convention. Next.js 16 deprecates it in favor of `proxy.ts`; rename it with `npx @next/codemod@latest middleware-to-proxy .` when convenient.
- Pin Better Auth when upgrading and re-run `npx auth generate` to catch schema changes.
