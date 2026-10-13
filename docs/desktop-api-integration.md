# Desktop login and report API integration

Status: implementation handoff, 2026-10-12.
Website source baseline: `7c33c5b`.

Audience: the Subtubes IRE desktop implementation in
`/Users/edgarmartinez/Code/diff-enginer`.

This document distinguishes the authentication API available today from the
proposed report-sharing API. It does not claim that a desktop login integration
or remote report storage has been implemented or tested end to end.

## 1. Scope and implementation boundary

**The desktop can implement login now using the existing Better Auth endpoints.**
It does not need to wait for the proposed `/api/v1` API.

| Capability | Backend status |
| --- | --- |
| Device code issuance, browser approval, token polling | Implemented |
| Bearer session authentication and session lookup | Implemented |
| Organization membership listing and explicit organization lookup | Implemented |
| Current-session sign-out | Implemented |
| `/api/v1/me` convenience response with membership roles | Implemented |
| Personal default organization (auto-created on registration, strictly private) | Implemented |
| Cloud Push Contract v1 (`/api/v1/organizations/{orgId}`) reports, snapshots, blobs, designs | Implemented |
| Immutable diagram versions, cloud discovery/pull and preferred-version election | Implemented backend; requires migration/deployment and desktop integration |
| Remote collaborative review operations | Proposed, not available |

Keep local report generation and storage working without login. Login enables
remote features; it must not become a prerequisite for existing local work.

## 2. Server configuration: development and production

Store a server profile containing an environment label and a website origin.
Derive API URLs from that origin:

| Profile | Website origin | Auth base | Future report API base |
| --- | --- | --- | --- |
| Local | `http://localhost:3000` | `/api/auth` | `/api/v1` |
| Production | `https://subtubes.com` | `/api/auth` | `/api/v1` |

For example, Local's device-code endpoint is
`http://localhost:3000/api/auth/device/code`.

Requirements:

- Default source-development builds to Local and release builds to Production.
  Require a confirmed production origin before shipping remote login.
- Show the selected server/environment in account settings and login UI.
- Keep this separate from the existing desktop "Dev mode", which only enables
  the diagnostic console.
- Permit HTTP only for explicitly selected loopback development servers.
  Require HTTPS for production. Do not disable TLS verification.
- Validate origins: no embedded credentials, query, fragment, or arbitrary
  path. Normalize consistently, preserving scheme, hostname, and port.
- Treat `localhost` and `127.0.0.1` as distinct origins. Use one consistently.
- Key credentials, remote caches, and mappings by exact origin and account ID.
- Capture the origin when starting an operation. Cancel login polling and
  prevent stale results from being applied when the profile changes.
- Never automatically fall back to another server or forward credentials to
  another origin, including via HTTP redirects.
- The website's `BETTER_AUTH_URL` must match its public origin. Device approval
  URLs are generated from this configuration.

The desktop Vite URL `http://localhost:1420` is not the website API.
Loopback login assumes the website runs on the same machine as the desktop.

## 3. Existing authentication API

These endpoints are mounted under `/api/auth`. Examples use synthetic values.
Parse responses by fields, tolerate additive fields, and do not log tokens.

### 3.1 Request a device code

```http
POST /api/auth/device/code
Content-Type: application/json
Accept: application/json

{
  "client_id": "subtubes-ire-desktop"
}
```

`subtubes-ire-desktop` is the proposed stable public identifier. The current
server requires a client ID but does not configure an allowlist. It is not a
client secret; never embed a server secret in the desktop binary.

Illustrative successful response:

```json
{
  "device_code": "<opaque-device-code>",
  "user_code": "ABCD2345",
  "verification_uri": "http://localhost:3000/device",
  "verification_uri_complete": "http://localhost:3000/device?user_code=ABCD2345",
  "expires_in": 1800,
  "interval": 5
}
```

Use the returned expiry and interval rather than hardcoding these defaults.
Keep the device code native/in memory for the duration of login. Show the user
code and a cancel action. Do not send `user_id` or request invented scopes.

Open `verification_uri_complete` in the system browser, not an embedded login
webview. Validate that its origin matches the selected website before opening
it. If browser launch fails, show the URL and user code for manual entry.
The user signs in and explicitly approves or denies at `/device`.

### 3.2 Poll for a token

```http
POST /api/auth/device/token
Content-Type: application/json
Accept: application/json

{
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "device_code": "<opaque-device-code>",
  "client_id": "subtubes-ire-desktop"
}
```

Use the same client ID and server as the code request. Wait at least the returned
interval before polling; allow only one poll in flight.

Illustrative successful response:

```json
{
  "access_token": "<opaque-session-token>",
  "token_type": "Bearer",
  "expires_in": 604800,
  "scope": ""
}
```

The expiry value above is illustrative, not a guaranteed session lifetime.
This is an opaque Better Auth session token, **not a JWT**. Do not decode it.
The current flow returns **no refresh token**. Session activity can affect
expiry; use validated session responses rather than assuming a fixed lifetime.

Device-flow error responses have `error` and `error_description`:

```json
{
  "error": "authorization_pending",
  "error_description": "Authorization is still pending"
}
```

| Error | Desktop behavior |
| --- | --- |
| `authorization_pending` | Continue polling at the permitted interval |
| `slow_down` | Increase interval by at least five seconds for subsequent polls |
| `access_denied` | Stop; show that approval was denied |
| `expired_token` | Stop; offer a new login attempt |
| `invalid_grant` | Stop; code may be invalid, consumed, or bound to another client |
| `invalid_request` / `invalid_client` | Stop; surface configuration/request error |
| Network timeout, 429, 5xx | Bounded backoff; honor `Retry-After`; stop at code expiry |

Check the HTTP status and parse error JSON; do not treat all non-2xx responses
as fatal while authorization is pending. Stop on cancellation, expiry, profile
change, or app shutdown. Do not automatically issue repeated new codes.

### 3.3 Validate session and load the account

```http
GET /api/auth/get-session
Authorization: Bearer <opaque-session-token>
Accept: application/json
```

Success returns an object containing `user` and `session`. Relevant fields:

```json
{
  "user": {
    "id": "<user-id>",
    "name": "Example User",
    "email": "user@example.test",
    "emailVerified": false
  },
  "session": {
    "id": "<session-id>",
    "userId": "<user-id>",
    "expiresAt": "2026-10-19T12:00:00.000Z"
  }
}
```

This is a field subset, not the complete response. Session payloads may themselves
contain credentials; only expose sanitized account/session metadata to React.

An unauthenticated session lookup can return **HTTP 200 with JSON `null`**.
Treat that as signed out, as well as an authentication failure. A network failure
is not proof that credentials expired: show Offline/Unable to verify instead.

Validate after token issuance, on app startup when a credential exists, and
when an authenticated operation fails. An expired/revoked session requires
reauthentication; do not invent a refresh-token endpoint.

### 3.4 List organizations

```http
GET /api/auth/organization/list
Authorization: Bearer <opaque-session-token>
Accept: application/json
```

Response is a **top-level array**, not `{ "organizations": [...] }`:

```json
[
  {
    "id": "<organization-id>",
    "name": "Example Organization",
    "slug": "example-organization",
    "createdAt": "2026-10-12T12:00:00.000Z"
  }
]
```

Additional fields such as logo or metadata may be present. This list contains
organizations the account belongs to; it does not provide the caller's role.
An empty array means signed in with no organizations, not login failure.
Offer to open the website dashboard to create an organization or accept an invite.

Validate a selected organization using an explicit ID:

```http
GET /api/auth/organization/get-organization?organizationId=<url-encoded-id>
Authorization: Bearer <opaque-session-token>
```

If membership details are needed, the existing
`GET /api/auth/organization/get-full-organization?organizationId=<url-encoded-id>`
returns organization details including members. Its member list can be limited;
do not assume it always contains the current user's role. Prefer the dedicated
`GET /api/v1/me` endpoint below to retrieve the caller's sanitized profile and
explicit organization roles without fetching all organization members.

**Do not call `/organization/set-active` for desktop navigation.** Keep selection
per window/workspace and pass organization IDs explicitly on every future API
operation. This avoids changing context for other browser or desktop tabs.
Recheck access if membership changes; a saved selection is not authorization.

### 3.5 Account and organization memberships (`/api/v1/me`)

```http
GET /api/v1/me
Authorization: Bearer <opaque-session-token>
Accept: application/json
```

Success returns HTTP 200 with sanitized user profile and an array of organizations
the user belongs to, including their specific membership role (`owner`, `admin`, `member`):

```json
{
  "user": {
    "id": "<user-id>",
    "name": "Example User",
    "email": "user@example.test",
    "emailVerified": false,
    "image": null,
    "username": "example",
    "displayUsername": "example"
  },
  "organizations": [
    {
      "id": "<organization-id>",
      "name": "Example Organization",
      "slug": "example-org",
      "logo": null,
      "role": "owner",
      "createdAt": "2026-10-12T12:00:00.000Z"
    }
  ]
}
```

Unauthenticated requests return HTTP 401:
```json
{
  "error": "unauthorized",
  "message": "Authentication required."
}
```

### 3.6 Sign out

```http
POST /api/auth/sign-out
Authorization: Bearer <opaque-session-token>
Content-Type: application/json
Accept: application/json

{}
```

Typical response: `{ "success": true }`. This targets the desktop's current
session, not all browser/device sessions. Do not call revoke-all-sessions.

Cancel pending remote operations and remove the local credential. If remote
logout fails, report that local logout completed but server revocation could
not be confirmed. Even after success, verify the old credential is rejected
with session lookup before claiming confirmed revocation; never retain it in
logs or UI state for this verification.

### 3.7 Request transport

Implement authenticated HTTP in the native layer and expose typed operations
through the existing Tauri command boundary. Keep bearer tokens out of React,
localStorage, SQLite report content, URLs, process arguments, and MCP config.

Native requests do not require browser CORS configuration. The initial login
requests need no browser cookie jar; subsequent API requests use the bearer
header. Browser approval retains its own normal website session.

Send JSON bodies/content type for POST requests. Do not fabricate browser
cookies or disable backend CSRF/origin checks. If an Origin header is supplied,
use the configured website origin; verify actual middleware acceptance during
integration rather than assuming webview-origin requests are equivalent.

## 4. Desktop implementation plan

Add a native remote-account service and a small React account controller,
following existing command/error patterns. Suggested operations:

- Read/update the selected nonsecret server profile.
- Start, cancel, and poll device authorization.
- Validate the stored session and return sanitized account state.
- List/validate organizations.
- Sign out and clear credentials.

Use macOS Keychain, following the existing research credential implementation
but with a separate service namespace. Bind entries to origin/account identity;
persist nonsecret last-used account metadata separately. Implement an explicit
OS credential-store strategy before claiming Windows/Linux support.

Suggested login states:

```text
Signed out -> Requesting code -> Awaiting browser approval
           -> Validating session -> Signed in -> Selecting organization
```

Denied, expired, offline, canceled, and configuration errors must be visible,
recoverable states. A late result from a canceled request must not sign the app in.

Remote context must include:

```text
server origin + account ID + organization ID + remote project/report ID
```

Remembered organization selection is a convenience per context, not shared
session authority. Capture this context for background work. Account/profile
changes must not redirect an in-flight upload into another organization.

Do not change MCP `publish_report` into an automatic network upload. It currently
saves locally. Remote sharing will be a separate explicit action.


## 5. Cloud Push Contract (v1) — Implemented

Desktop pushes reports, snapshots, blobs, and designs to `/api/v1/organizations/{orgId}`.

### 5.1 Personal organization lifecycle
- Every user automatically receives a default personal organization upon registration.
- It is private to the user: invitations, adding members, and removing members are blocked.
- Members cannot leave their personal organization.
- It cannot be deleted directly; deleting the user account cascades and cleans it up.

### 5.2 Endpoints and operations

All requests require Bearer token authorization in the `Authorization` header and the caller must be a member of `orgId`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/organizations/:orgId/limits` | Size/count limits and supported schema versions |
| POST | `/api/v1/organizations/:orgId/blobs/missing` | Find un-uploaded blob hashes |
| PUT | `/api/v1/organizations/:orgId/blobs/:sha256` | Raw binary blob upload |
| GET | `/api/v1/organizations/:orgId/designs` | Paginated preferred-diagram discovery |
| GET | `/api/v1/organizations/:orgId/designs/:designId` | Pull the preferred complete definition |
| GET | `/api/v1/organizations/:orgId/designs/:designId/versions` | Paginated immutable history |
| GET | `/api/v1/organizations/:orgId/designs/:designId/versions/:versionId` | Pull an exact saved version |
| POST | `/api/v1/organizations/:orgId/designs/:designId/versions` | Save a version; elect only if expected head is current |
| PUT | `/api/v1/organizations/:orgId/designs/:designId/preferred` | Explicitly elect a saved version with a head-generation check |
| PUT | `/api/v1/organizations/:orgId/reports/:reportId/snapshots/:number` | Write-once snapshot upload with hash idempotency |
| PUT | `/api/v1/organizations/:orgId/reports/:reportId` | Report head publication with If-Match concurrency |
| GET | `/api/v1/organizations/:orgId/reports/:reportId/status` | Report revision and available snapshots |

### 5.3 Payload limits and validation
- Maximum report/snapshot document size: 10 MiB
- Maximum design document size: 2 MiB
- Maximum blob size: 5 MiB
- Supported report schema versions: `[2]`
- Supported design schema versions: `[1]` (`supportedDesignSchemaVersions` in `/limits`)
- Maximum design blob references: 500 (`maxBlobsPerDesign` in `/limits`)
- Inline media (`data:image/...`, `data:video/...`, `data:audio/...`) is strictly forbidden and rejected with `422 inline_media`. Blobs must be uploaded to `/blobs/:sha256` and referenced by hash.

### 5.4 Diagram versions and preferred working copy

**No merging.** Every accepted push creates an immutable definition under the
same design ID. One pointer selects the preferred cloud working copy. Old
versions and attachments remain downloadable. Only organization members can
read, and only the design owner can push versions or elect the leader.
Another computer signed into the same account has those same owner permissions.
Account/organization deletion still removes their data.

This contract **replaces** the old single-document `PUT /designs/:designId`
(now unsupported / HTTP 405). It does not change report/snapshot uploads.
Backend routes are implemented in this checkout; production deployment and the
desktop interface/checkpoint store must be coordinated separately.

#### Three different version concepts

- `document.revision`: the desktop's local document revision, preserved as
  metadata; never use it as a cloud concurrency precondition.
- Saved `version.id` / `version.number`: immutable server-issued identity and
  ascending per-design sequence. Sequence is upload order, not preference.
- `headGeneration`: server-controlled generation of the preferred pointer.
  It increments whenever the leader changes, even if electing an old version.
  An A -> B -> A election cannot satisfy a stale precondition.

#### Push

Upload missing blobs first, then submit:

```http
POST /api/v1/organizations/:orgId/designs/:designId/versions
Authorization: Bearer <session-token>
Content-Type: application/json
```

```json
{
  "uploadId": "802dff3e-7fa6-4b5d-928c-bac4b4d46018",
  "expectedHeadGeneration": 0,
  "deviceLabel": "Laptop",
  "document": {
    "name": "Architecture",
    "kind": "swimlane",
    "schemaVersion": 1,
    "revision": 3,
    "content": { "nodes": [], "links": [], "groups": [] },
    "refs": { "blobs": [] }
  }
}
```

`uploadId` is a fresh UUID for each intentional push and must be retained across
transport retries. `expectedHeadGeneration` is required: zero means no cloud
diagram; thereafter send the generation observed during the last pull/read.
`deviceLabel` is optional display metadata (1-100 trimmed characters), not
trusted identity. Name is 1-200 trimmed characters, kind is `swimlane` or `system`,
schema version is currently 1, local revision is a positive integer, and content
is a JSON object. Envelopes reject unknown fields. Enumerate all images in
`refs.blobs` (at most 500 SHA-256 hashes); hashes are normalized and deduplicated.
The 2 MiB limit applies to the entire request including the envelope.

On a new saved version, HTTP 201:

```json
{
  "success": true,
  "replayed": false,
  "designId": "<design-id>",
  "preferredVersionId": "<current-leader-version-id>",
  "headGeneration": 4,
  "versionCount": 6,
  "savedVersion": {
    "id": "<new-version-id>",
    "number": 6,
    "uploadId": "802dff3e-7fa6-4b5d-928c-bac4b4d46018",
    "contentHash": "sha256:<server-computed-hash>",
    "authorId": "<authenticated-owner-id>",
    "deviceLabel": "Laptop",
    "createdAt": "<ISO timestamp>",
    "name": "Architecture",
    "kind": "swimlane",
    "schemaVersion": 1,
    "revision": 3
  },
  "outcome": "saved_requires_selection"
}
```

- `saved_and_preferred`: expected generation matched; the saved version was
  elected in the same transaction.
- `saved_requires_selection`: expected generation was stale; the version is
  durably saved but the leader did **not** move. Show a chooser, not generic
  “synced” feedback. This is not an unsaved HTTP 409.
- Exact retry: HTTP 200, `replayed: true`, same saved version, no extra version
  or election. Head fields and outcome describe the **current** preference,
  which may have changed since the original request.
- Upload-ID reuse with changed document, device label or expected generation:
  HTTP 409 `upload_id_conflict`; no data changed. A new intentional push needs
  a new UUID. Equal content with distinct upload IDs is retained as separate
  intentional versions.

The canonical content hash covers the normalized full `document`, including name,
kind, schema version, local revision, content and refs. Object key order is
canonicalized; array order is significant. It excludes upload/device/head fields.

#### Discovery, history and pull

- `GET /designs?limit=25&cursor=<last-design-id>` returns
  `{ success, designs, nextCursor }`. Designs are ordered by ID ascending;
  each includes `id`, `ownerId`, `name`, `kind`, `preferredVersionId`,
  `headGeneration`, `versionCount`, preferred `number`/`contentHash`, and
  ISO `updatedAt`. No full documents appear in discovery results.
- `GET /designs/:id` returns
  `{ success, designId, preferredVersionId, headGeneration, versionCount, version }`.
  `version` includes the saved metadata above and the complete `document`.
- `GET /designs/:id/versions?limit=25&cursor=<last-version-number>` returns
  `{ success, designId, preferredVersionId, headGeneration, versions, nextCursor }`.
  Versions are newest-first saved metadata plus a `preferred` boolean.
- `GET /designs/:id/versions/:versionId` returns
  `{ success, designId, version }` with the exact historical document.

Limits are integers from 1 to 100. `nextCursor: null` means no more results.
Use the returned cursor rather than offsets. Read responses are `Cache-Control:
no-store`; the leader can change at any moment. Blob downloads use the existing
organization-scoped authenticated `GET /blobs/:sha256`.

#### Explicit winner selection

```http
PUT /api/v1/organizations/:orgId/designs/:designId/preferred
Authorization: Bearer <session-token>
Content-Type: application/json
```

```json
{
  "versionId": "<chosen-saved-version-id>",
  "expectedHeadGeneration": 4
}
```

HTTP 200 returns `{ success, designId, preferredVersionId, headGeneration,
versionCount }`. Selecting the already-preferred version with a current
generation is a no-op. The candidate must belong to this design and organization.
The request is bounded to 4 KiB.

If another computer changes the leader during the decision, HTTP 409
`head_conflict` includes current head fields in `error.details`. Fetch the
current candidates and ask again; never force or retry a choice with a new
generation without user review. No saved definition is edited or deleted.

#### Desktop UX and checkpoints (integration required)

1. New computer: list designs, download the preferred definition and blobs.
2. Store checkpoint by exact server/account/org/design:
   preferred version ID, head generation, base document/hash and local edit
   generation. Keep local revisions separate from cloud versions.
3. Push a captured local document. On conflict, present:
   **Use my pushed version**, **Keep current cloud version**, or
   **Choose another saved version**. Cancel changes neither pointer nor local
   working copy; the just-pushed candidate still exists in history.
4. All choices are winner elections, not merges. “Keep both” happens implicitly
   because neither saved version is deleted. No fork is needed to preserve both.
5. Electing a cloud leader does **not** replace this computer's local document.
   Pulling is a separate explicit action. Confirm overwriting unsynced local
   work, save a recoverable local backup, and install the full document/blobs
   atomically only if the captured local edit generation is still current.
6. If local edits continue during a push, keep them unsynced; checkpoint only
   the document actually saved. A successful cloud election does not imply
   every computer now has that version.
7. Lost upload response: retry the same upload ID and payload. Lost election
   response: fetch the current head; do not blindly replay a stale choice.
   Offline/auth/network errors must retain local work and show retry guidance.

Error envelopes retain `{ error: { code, message, details? } }`.
Missing/malformed preconditions are HTTP 422 `invalid_document` before saving.
Missing blobs are 422 `missing_blobs`; inline images are 422 `inline_media`;
oversize is 413 `too_large`; wrong media type is 415 `invalid_document`;
invalid pagination is 422 `invalid_page`. Authentication/membership/owner
failures use 401/403, and inaccessible design/version lookups use 404.
Unexpected database failures are logged and return 500 `internal_error`.

### Proposed identity and storage model

- Remote projects belong to one organization and are not local Git paths.
- Store an explicit local-project-to-remote-project mapping, scoped to origin,
  account, and organization. Do not silently match by display name or Git URL.
- Give remote reports server IDs; retain local origin IDs only as provenance.
- Store validated report content/revisions separately from mutable review state.
- Store images as blobs with organization-scoped attachment records and hashes.
- Record uploader/reviewer identity from authentication, not client assertions.
- Use Kysely migrations for backend schema changes.

Downloaded reports must be viewable without a local Git checkout. Local
Git/agent features can require an explicitly linked repository later.

### Proposed publication envelope

```json
{
  "apiVersion": 1,
  "source": {
    "localProjectId": "<local-project-id>",
    "localReportId": "<local-report-id>"
  },
  "report": "<validated portable Report object, not a string>",
  "attachments": [
    {
      "hash": "<sha256>",
      "mime": "image/png",
      "bytes": 12345,
      "filename": "dashboard.png"
    }
  ]
}
```

The `report` placeholder illustrates nesting only. Final JSON schema, payload
limits, response DTOs, and upload sequencing must be specified before this API
is implemented. Do not reuse permissive desktop paste normalization as the
server validation boundary.

The publication sequence should upload missing assets, then atomically publish
a report referencing only verified, available organization assets. Include an
`Idempotency-Key`; bind it to caller/destination and payload so retrying cannot
duplicate reports or accept different content under the same key.

Reports currently contain embedded screenshots and separate
`attachment:<sha256>` references. Both must be packaged. A JSON-only upload can
leave images missing on another machine. Deduplicate by hash without exposing
cross-organization asset existence or granting access by hash alone.

### Portability and privacy

Define a remote schema that preserves diffs, narrative, evidence, diagram
snapshots, and selected review data while excluding unnecessary absolute paths,
credentials, local chat/session-resume metadata, and diagnostics.

Live design, ticket, and feature links may reference local-only resources.
Preserve portable embedded snapshots where available; explicitly label links
that cannot resolve remotely. Report diffs and screenshots can contain private
code/data: show the destination and require explicit sharing.

### Review synchronization and failures

- Published content is immutable; subsequent content changes create revisions.
- Review threads/status are separate revision-checked mutations.
- Use expected revisions or `If-Match`; return conflict instead of overwriting.
- Attribute imported historical review notes as provenance, not newly verified
  authenticated actions by another person.
- Keep a local cache and explicit retry/outbox state. Failed uploads remain
  local and visibly unpublished.
- Do not replace an entire remote report with a stale local snapshot.
- Propose stable error responses with `code`, `message`, and `requestId`.
- Use 401 for missing/expired authentication, 403 for denied actions, a consistent
  non-disclosing 404 policy for inaccessible resources, 409 for conflicts, 413
  for excessive payloads, 429 for throttling, and explicit validation errors.
  Better Auth endpoints retain their existing error shapes.

Publishing/review role policy, report size/asset limits, retention, deletion,
and cache access after logout/membership removal are product decisions still
required. Do not infer these from invitation-management permissions.

## 6. Delivery phases

1. **Desktop login now:** profiles, native device flow, secure credentials,
   session validation, account UI, organization picker, logout.
2. **Backend sharing:** finalize role policy and portable DTOs; add migrations,
   organization-scoped projects/reports/assets and authorization tests.
3. **Desktop sharing and website review:** explicit publish, list/download,
   offline rendering with assets, project mapping, website report viewer.
4. **Collaborative review:** authenticated threads/decisions/status, incremental
   refresh, revisions, conflicts, and deliberate offline mutation policy.
5. **Optional agent integration:** explicit remote MCP actions only after
   account/destination/consent handling is established.

## 7. Login acceptance checklist

Use isolated synthetic accounts/organizations; do not reset shared databases.

- Local browser approval completes desktop login against localhost:3000.
- Production/staging approval uses its configured HTTPS origin; never localhost.
- Code issuance and polling send the exact required fields and client ID.
- Pending, slow-down, denial, expiry, cancellation, and network failures behave
  distinctly; polling remains single-flight.
- Profile/window changes prevent stale login results from being applied.
- Invalid token and HTTP 200 `null` session responses become signed out.
- Offline session validation is not mislabeled as invalid credentials.
- Restart restores credentials securely and validates the account.
- Zero, one, and multiple organization memberships render correctly.
- Organization lookup always supplies an explicit ID; no `set-active` call.
- Revoked membership invalidates selection and blocks remote actions.
- Local reports remain usable without login or network connectivity.
- Sign-out clears local credentials and confirms/reports server revocation.
- Tokens never appear in frontend state, logs, diagnostics, URLs, or report JSON.
- Origin isolation is tested with two independent servers/accounts, including
  redirects and attempts to switch profiles during an operation.

No live end-to-end device-flow validation was performed for this document.
Before production release, verify client-ID allowlisting, issuance/polling abuse
controls, session expiry/revocation, trusted-origin behavior, TLS, and secure
credential storage.

## 8. Source references

Website:
- [Auth configuration](../lib/auth.ts)
- [Better Auth route handler](../app/api/auth/[...all]/route.ts)
- [Browser device page](../app/device/page.tsx)
- [Device approval UI](../components/device-approval.tsx)
- [Request-scoped organization workspace](../app/dashboard/organizations/[slug]/page.tsx)

Desktop paths, relative to the desktop repository:
- `app/src/native.ts`: Tauri command boundary.
- `app/src/useApplication.ts`: local report navigation/import/export.
- `app/src/App.tsx`: settings and console-only Dev mode.
- `app/src-tauri/src/question_agent.rs`: existing macOS Keychain pattern.
- `app/src-tauri/src/storage.rs` and `src/library.ts`: local snapshots.
- `src/types.ts`: Report/Snapshot types.
- `src/attachments/model.ts` and `src/attachments/service.ts`: image references/storage.
- `src/comments/service.ts`: existing expected-revision pattern.
- `src/server.ts`: local MCP publication.
