# Desktop login, report, and design API integration

Status: implementation handoff, updated 2026-10-15 for the single-copy model.
The cloud keeps **one current copy** of each report and each diagram; there is
no version or snapshot history.

Audience: the Subtubes IRE desktop implementation in
`/Users/edgarmartinez/Code/diff-enginer`.

This document describes the authentication and cloud APIs available today,
with deployment status called out where it differs. It does not claim
that this website implements the desktop UI, local clone commands, or checkpoints.

## 1. Scope and implementation boundary

**The desktop can implement login now using the existing Better Auth endpoints.**
The organization-scoped `/api/v1` cloud API is also deployed.

| Capability | Backend status |
| --- | --- |
| Device code issuance, browser approval, token polling | Implemented |
| Bearer session authentication and session lookup | Implemented |
| Organization membership listing and explicit organization lookup | Implemented |
| Current-session sign-out | Implemented |
| `/api/v1/me` convenience response with membership roles | Implemented |
| Personal default organization (auto-created on registration, strictly private) | Implemented |
| Cloud Push Contract (`/api/v1/organizations/{orgId}`): reports, designs, blobs; one current copy each, last write wins | Implemented in this checkout (see section 5.7 for deployment) |
| Cloning a report or design (API), and cloning a report from the website | Implemented in this checkout |
| Document compatibility metadata and race-safe unreadable-copy protection | Implemented in this checkout; not deployed; desktop reader integration required |
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


## 5. Cloud Push Contract — Implemented

Desktop pushes reports, designs and blobs to `/api/v1/organizations/{orgId}`.
The cloud holds **one current copy** of each report and each design. A push
**replaces** it: the last write wins. There are no versions, preferred pointer,
snapshots, `If-Match` preconditions, upload IDs for documents, or conflict
responses for concurrent writers. To keep an older state, clone (section 5.4).

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
| POST | `/api/v1/organizations/:orgId/blobs/uploads` | Authorize a direct private image upload |
| POST | `/api/v1/organizations/:orgId/blobs/uploads/:uploadId/complete` | Verify storage bytes and register a ready image |
| GET | `/api/v1/organizations/:orgId/blobs/:sha256` | Download organization-scoped image bytes |
| GET | `/api/v1/organizations/:orgId/designs` | Paginated design discovery |
| GET | `/api/v1/organizations/:orgId/designs/:designId` | Pull the current complete definition |
| PUT | `/api/v1/organizations/:orgId/designs/:designId` | Create or replace the current copy (owner only) |
| POST | `/api/v1/organizations/:orgId/designs/:designId/clone` | Independent copy owned by the caller |
| GET | `/api/v1/organizations/:orgId/reports` | Report discovery |
| GET | `/api/v1/organizations/:orgId/reports/:reportId` | Read the current report |
| PUT | `/api/v1/organizations/:orgId/reports/:reportId` | Create or replace the current report (owner only; `If-Match`/`If-None-Match` ignored) |
| POST | `/api/v1/organizations/:orgId/reports/:reportId/clone` | Independent copy owned by the caller |

The following routes no longer exist and answer 404:
`/designs/:id/versions`, `/designs/:id/versions/:versionId`,
`/designs/:id/preferred`, `/reports/:id/snapshots`,
`/reports/:id/snapshots/:number` and `/reports/:id/status`, as does the website
route `/api/organizations/:slug/reports/:id/snapshots/:number`.

Images use the [direct private image upload contract](./report-image-uploads.md).
Desktop optimization occurs before local saving/hashing, with a 2 MiB final
limit. The API authorizes uploads, verifies storage bytes, and registers each
ready image; report publication waits for all image references. The raw PUT route
remains for older clients. A private report Blob store and migration are required
before rollout; the public avatar store is not suitable.

### 5.3 Payload limits and validation
- Maximum report document size: 10 MiB (`maxReportDocumentBytes`)
- Maximum design document size: 2 MiB (`maxDesignDocumentBytes`)
- Maximum blob size: 2 MiB (2,097,152 bytes); 16,384 pixels per side
- Maximum blob references: 500 per design (`maxBlobsPerDesign`) and per report (`maxBlobsPerReport`)
- Supported report schema versions: `[2]`
- The compatibility extension adds `supportedReportSchemaVersions: [2]`; the
  existing `supportedSchemaVersions: [2]` remains an alias for older clients.
- Supported design schema versions: `[1]` (`supportedDesignSchemaVersions` in `/limits`)
- `/limits` also returns `documentCompatibilityMetadata`, `documentReaderCapabilities`,
  `maxImageSide`, `directImageUploads`, `imageUploadConcurrency` and `allowedBlobTypes`.
  It no longer advertises `designSnapshotMetadata`, `maxSnapshotDocumentBytes` or
  `maxSnapshotsPerReport`.
- Inline media (`data:image/...`, `data:video/...`, `data:audio/...`) is strictly forbidden and rejected with `422 inline_media`. Blobs must be uploaded to `/blobs/:sha256` and referenced by hash.

### 5.4 Diagrams and reports: one current copy

**No merging and no history.** Each design and each report has a single current
copy per organization. Only organization members can read; only the owner can
replace it. Another computer signed into the same account has the same owner
permissions. A different member who wants their own editable copy clones it.
Account/organization deletion still removes the data.

This contract **replaces** the earlier immutable-version model. The old
`POST /designs/:id/versions` and `PUT /designs/:id/preferred` routes are gone
(404), and `PUT /designs/:designId` is the supported way to create or replace a
design.

#### Identifiers

- `document.revision`: the desktop's local document revision, preserved as
  metadata; never a cloud concurrency precondition.
- `contentHash`: server-computed canonical hash of the normalized document (see
  below). Used for receipts and change detection, not for preconditions.

#### Push a design

Upload missing blobs first, then submit:

```http
PUT /api/v1/organizations/:orgId/designs/:designId
Authorization: Bearer <session-token>
Content-Type: application/json
```

```json
{
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

`deviceLabel` is optional display metadata (1-100 trimmed characters), not
trusted identity. Name is 1-200 trimmed characters, kind is `swimlane` or `system`,
schema version is currently 1, local revision is a positive integer, and content
is a JSON object. Envelopes reject unknown fields. Enumerate all images in
`refs.blobs` (at most 500 SHA-256 hashes); hashes are normalized and deduplicated.
The 2 MiB limit applies to the entire request including the envelope. The design
ID is chosen by the client (1-200 characters).

First push, HTTP 201:

```json
{
  "success": true,
  "designId": "<design-id>",
  "contentHash": "sha256:<server-computed-hash>",
  "updatedAt": "<ISO timestamp>",
  "created": true
}
```

Replacing an existing copy returns HTTP 200 with the same shape and
`created: false`.

- Only the owner may replace a copy: `403 forbidden`; the message tells the
  caller to clone it instead. A design that belongs to another organization is
  `404 not_found`.
- An existing copy this reader cannot read is never replaced: a newer schema
  returns `426 upgrade_required`, a damaged copy `422 invalid_document`.
- Missing blobs are `422 missing_blobs`; inline media is `422 inline_media`.
- Pushes are last-write-wins. Two first pushes that race both succeed: one
  creates the copy and the other replaces it.
- Retrying an unchanged push is safe; it replaces the copy with identical content.

The canonical content hash covers the normalized full `document`, including name,
kind, schema version, local revision, content and refs. Object key order is
canonicalized; array order is significant. It excludes `deviceLabel`.

#### Discovery, read and pull

- `GET /designs?limit=25&cursor=<last-design-id>` returns
  `{ success, designs, nextCursor }`. Designs are ordered by ID ascending;
  each includes `id`, `ownerId`, `name`, `kind`, `revision`, `contentHash` and
  ISO `updatedAt`. No full documents appear in discovery results.
  Requests that declare a design reader (see section 5.5) also receive
  `schemaVersion` and a `compatibility` state; legacy requests retain
  schema-1 discovery.
- `GET /designs/:id` returns
  `{ success, designId, ownerId, contentHash, updatedAt, document }`, where
  `document` is `{ name, kind, schemaVersion, revision, content, refs: { blobs } }`.
- `GET /reports` returns `{ success, reports }`; each summary has `id`, `name`,
  `projectName`, `savedAt` and no `snapshots` field. Declared readers receive
  metadata only, paginated by ID (see section 5.5). `GET /reports/:id` returns
  the current report document and its revision, hash and timestamps.

Limits are integers from 1 to 100. `nextCursor: null` means no more results.
Use the returned cursor rather than offsets. Read responses are `Cache-Control:
no-store`. Blob downloads use the existing organization-scoped authenticated
`GET /blobs/:sha256`.

#### Push a report

`PUT /reports/:reportId` creates the report or **replaces its one current copy**
and returns `200 { success, reportId, revision }`. No `If-Match` is needed; any
`If-Match` or `If-None-Match` header is ignored.

- Only the owner may replace it: `403 forbidden`. A report in another
  organization is `404 not_found`.
- An existing copy this reader cannot read (newer schema, damaged) is never
  replaced (`426 upgrade_required` / `422 invalid_document`).
- Referenced blobs and designs must already exist in the organization:
  `422 missing_blobs` / `422 missing_designs`. Push images and designs first and
  the report last, so the cloud never holds a report pointing at something
  missing.
- The envelope is `{ schemaVersion: 2, contentHash, report, refs?, revision, project? }`;
  the size limit is 10 MiB.

#### Clone

Cloning makes an independent copy owned by the caller; the source is never
changed and the copy is not linked to it.

- `POST /designs/:designId/clone` returns `201 { success, designId, name,
  contentHash, updatedAt, created: true }`. `designId` is new, `name` is
  "Copy of <name>" (at most 200 characters), the revision is 1, and image
  references stay the same organization-scoped blobs.
- `POST /reports/:reportId/clone` returns `201 { success, reportId, name,
  revision: 1, contentHash, updatedAt }`, with `name` "Copy of <title>".
- Any organization member may clone; the copy belongs to the caller. A source
  from another organization is `404`; a source this reader cannot read is `426`
  or `422`.

#### Desktop UX and checkpoints (integration required)

1. New computer: list designs, download the current definition and blobs.
2. Store a checkpoint by exact server/account/org/design: the base
   document/hash and local edit generation. Keep local revisions separate from
   the cloud copy.
3. Push a captured local document. It replaces the cloud copy; there is no
   conflict dialog. Read the existing cloud copy first and stop if it has a newer
   schema or is damaged. Skip the write when the document is unchanged since the
   checkpoint and the cloud hash still matches it.
4. Pull is a separate explicit action. Confirm overwriting local work only when
   the local design has unsent changes, and tell the user they can clone first to
   keep a copy. Install the full document/blobs atomically only if the captured
   local edit generation is still current.
5. If local edits continue during a push, keep them unsynced; checkpoint only
   the document actually saved.
6. Offline/auth/network errors must retain local work and show retry guidance.

Error envelopes retain `{ error: { code, message, details? } }`.
Unsupported positive schema versions use `unsupported_schema_version`, not
`invalid_document`, once the compatibility extension is deployed.
Malformed requests are HTTP 422 `invalid_document`.
Missing blobs are 422 `missing_blobs`; missing report designs are 422
`missing_designs`; inline images are 422 `inline_media`;
oversize is 413 `too_large`; wrong media type is 415 `invalid_document`;
invalid pagination is 422 `invalid_page`. Authentication/membership/owner
failures use 401/403 (`forbidden` for a non-owner replace), a copy this reader
cannot read is 426 `upgrade_required`, a damaged one 422 `invalid_document`, and
inaccessible design/report lookups use 404.
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
- Use expected revisions for review mutations; return conflict instead of overwriting.
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

## 5.5 JSON document compatibility (implemented, not deployed)

This backend change enables no new document format and requires no database
migration. Deploy the server before clients negotiate its capabilities.

| Number | Meaning |
| --- | --- |
| Desktop SQLite `user_version` | Local database layout, not cloud document format |
| JSON `schemaVersion` | Interpretation of a serialized document |
| `revision` | Mutable/local source revision, not a format or a concurrency token |
| `/api/v1` | HTTP protocol, independent of payload schemas |

Cloud design documents remain wire schema **1**; cloud reports remain wire
schema **2**. Local report payload schema **1** inside
a cloud report is a separate format. The backend preserves complete JSON objects
and references; it does not relabel, down-convert or bulk-rewrite stored content.
Local design/report validators, SQLite upgrades, offline libraries, native/MCP
guards and pending-upload persistence remain desktop responsibilities.

### Capability negotiation and reader headers

The extension adds these organization-scoped `/limits` fields:

```json
{
  "supportedDesignSchemaVersions": [1],
  "supportedReportSchemaVersions": [2],
  "documentCompatibilityMetadata": true,
  "documentReaderCapabilities": true
}
```

After observing the positive capabilities, declare the formats this reader
actually understands on **every** relevant read and upload request. Each header is a comma-separated list of 1-16 positive safe integers:

```http
X-Subtubes-Design-Schema-Versions: 1
X-Subtubes-Report-Schema-Versions: 2
```

Do not infer support from app versions or advertise formats the client cannot
decode. Missing headers permanently mean the legacy design `[1]` or report `[2]`
reader, even when a future server adds new formats. Malformed headers return
422 `invalid_reader_capabilities`. Headers do not change upload envelopes.
Authorization still precedes metadata or compatibility responses.

### Metadata and mixed-version libraries

With an explicit resource reader header, design and report discovery entries
include each stored **wire** schema and:

```json
{
  "compatibility": {
    "status": "unsupported",
    "schemaVersion": 3,
    "message": "This document requires a newer app. Update Subtubes IRE."
  }
}
```

States are `supported`, `unsupported`, and `invalid`. No compatibility annotation
is part of the hashed document. Unsupported items are neither decoded into the
current model nor filtered out. IDs and pagination remain intact. Supported items on the same page remain usable.
Supported-schema corrupt JSON, invalid references or mismatched design hashes
receive `invalid` rather than empty/default documents.

- Design discovery adds `schemaVersion`. Legacy discovery omits it,
  retaining its existing schema-1 shape.
- Compatibility-aware `GET /reports?limit=25&cursor=<id>` returns metadata-only
  `reports` (`id`, `name`, `projectName`, `schemaVersion`, `revision`,
  `contentHash`, `savedAt`, `compatibility`) plus `nextCursor`, ordered by ID
  ascending. Legacy requests retain the existing summary shape/order for
  supported reports.
- Explicit-reader report detail reads also include stored `refs`.
- Limits are 1-100, default 25; `nextCursor: null` ends a page sequence.

Legacy list requests encountering an unsupported item return **426
`upgrade_required`**, not a filtered or downgraded page. Installed legacy binaries
cannot gain per-item compatibility UI retroactively. Invalid content reads return
422 `invalid_document`; unsupported content reads return 426 `upgrade_required`.
Neither returns a success-shaped empty document.

### Validation, mutation safety and retries

Cloud envelopes require a schema marker. Missing, null, string, zero, fractional
or unsafe markers are invalid; a well-formed unsupported positive integer returns
422 `unsupported_schema_version` with:

```json
{
  "error": {
    "code": "unsupported_schema_version",
    "message": "The requested document schema is not supported.",
    "details": {
      "documentType": "design",
      "schemaVersion": 2,
      "supportedSchemaVersions": [1]
    }
  }
}
```

The corresponding report error uses `documentType: "report"` and supported `[2]`.
Wire validation checks the declared envelope, positive revisions/sequences,
JSON-object content, attachment/hash references and existing size/count/media
limits. Every `attachment:<hash>` in content must be enumerated in `refs.blobs`;
all referenced blobs and designs must exist in the authorized organization before
a new publication. JSON content is retained losslessly; desktop semantic decoders
must separately validate the local model before editing or rendering.

Design and report writes lock the row and check the **existing** copy against
the reader and server's supported schemas **inside the transaction**. A copy
with an unsupported schema returns 426 `upgrade_required` and a damaged one
422 `invalid_document`; neither is replaced, and nothing is mutated. Corrupt
copies cannot be overwritten through these operations either. Last write wins
only between copies the writer can read. Cloning applies the same readability
checks to its source.

Reader headers never rewrite an envelope or its hash. Unknown schemas are never
decoded using a supported validator.

The website report library and viewer also guard their direct database reads:
unsupported/invalid rows remain visible with version details and cannot open.
This does not implement the desktop UI or its persistence guards.

Before any new format is enabled, release compatible readers, coordinate legacy
upgrade behavior, add that format's validator and regression tests, and test
mixed histories and incompatible-head races. Do not add incompatible content
fields to an existing schema merely because TypeScript calls them optional.

## 5.6 Website: cloning a report

The website is session-authenticated (not bearer) and same-origin only.

```http
POST /api/organizations/:slug/reports/:reportId/clone
```

The caller must be a member of the organization identified by `slug` (otherwise
404). A cross-origin `Origin` header is rejected with 403, and a missing session
with 401 `unauthenticated`. Success is HTTP 201 with `{ success, reportId, name,
revision, contentHash, updatedAt }` for a new report owned by the caller, named
"Copy of <title>" at revision 1.

The **Clone report** button on the report page and the **Clone** button on each
row of the organization reports list call this route. The report page no longer
has a snapshot Version picker or snapshot banner, and the list has no Snapshots
column. The website has no designs UI; designs are cloned through the API or the
desktop.

## 5.7 Deployment, migration and dormant data

Deploy the website and the desktop **together**. The desktop now calls
`PUT /designs/:designId`, which an older website build does not have, and the
new website no longer serves the removed history, preferred, snapshot or status
routes.

Apply migration `20261015000000_single_copy_designs` (`npm run db:migrate`)
before deploying the matching server. It is additive: it adds `name`, `kind`,
`schemaVersion`, `revision`, `content`, `refs`, `contentHash` and `deviceLabel`
to `design` and backfills each design from its preferred version, else its newest
version. A design row with no version holds no content and is deleted. The
migration refuses a destructive `down`; restore a verified backup or write a
forward migration to roll back.

The old `designVersion` and `reportSnapshot` tables and the
`preferredVersionId`, `headGeneration` and `versionCount` columns are left in
place and are no longer read or written. They are dormant; account and
organization deletion still cascade them. Existing version and snapshot history
is therefore not shown anywhere. The `20261014000000_design_snapshot_metadata`
migration remains in the history and is likewise unused.

Document schemas are unchanged: report wire schema 2 and design wire schema 1.

Run `npx tsx --test tests/design-copies.test.ts` for the real-PostgreSQL suite
of the single-copy design and clone behavior (the other API suites are
`tests/reports-api.test.ts`, `tests/desktop-api.test.ts` and
`tests/cloud-push-and-personal-org.test.ts`).

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
- [Design push, read and clone](../lib/cloud-push/designs.ts)
- [Report push, read and clone](../lib/cloud-push/reports.ts)
- [Document compatibility and reader headers](../lib/cloud-push/document-compatibility.ts)
- [Shared limits and responses](../lib/cloud-push/common.ts)
- [Design routes](../app/api/v1/organizations/[orgId]/designs/route.ts), its
  [`[designId]`](../app/api/v1/organizations/[orgId]/designs/[designId]/route.ts) and
  [clone](../app/api/v1/organizations/[orgId]/designs/[designId]/clone/route.ts) routes
- [Report routes](../app/api/v1/organizations/[orgId]/reports/route.ts), its
  [`[reportId]`](../app/api/v1/organizations/[orgId]/reports/[reportId]/route.ts) and
  [clone](../app/api/v1/organizations/[orgId]/reports/[reportId]/clone/route.ts) routes
- [Website clone route](../app/api/organizations/[slug]/reports/[reportId]/clone/route.ts) and
  [clone button helper](../components/report/clone-report.ts)
- [Single-copy migration](../migrations/20261015000000_single_copy_designs.ts)

Desktop paths, relative to the desktop repository:
- `app/src/native.ts`: Tauri command boundary.
- `app/src/useApplication.ts`: local report navigation/import/export.
- `app/src/App.tsx`: settings and console-only Dev mode.
- `app/src-tauri/src/question_agent.rs`: existing macOS Keychain pattern.
- `app/src-tauri/src/storage.rs` and `src/library.ts`: local saved reports and cloning.
- `src/types.ts`: Report/Snapshot types (`Snapshot` is the legacy name of a saved report).
- `src/attachments/model.ts` and `src/attachments/service.ts`: image references/storage.
- `src/comments/service.ts`: existing expected-revision pattern.
- `src/server.ts`: local MCP publication.
