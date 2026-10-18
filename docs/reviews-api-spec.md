# Private reviews API (v1)

Backend contract implemented by the Next.js App Router API and Kysely migrations.
The desktop integration and website review UI are out of scope. The retired
`/reports` and `/designs` APIs are not restored.

This is the authoritative wire contract. Use the companion
[desktop integration guide](desktop-reviews-integration.md) for client sequencing,
recovery, local sync state, and acceptance checks; it does not replace this spec.

## Organization and owner requirements

Organization membership is mandatory. Authentication alone, authorship, reviewer
assignment, or a former owner/admin role never grants access to an organization.

- Every review, revision, report record, blob, reference, participant, and upload
  intent is organization-scoped. Database composite foreign keys prevent
  cross-organization child references.
- Each `reviewReport` row stores its server-generated `id`, `organizationId`,
  `ownerId`, `ownerName`, `revisionId`, client ID, and report envelope. `ownerId`
  comes from the authenticated uploader, never the request body. Membership is
  checked in the transaction creating it. Each revision's report records retain
  their own owner attribution.
- `ownerId` references `user.id`. Account deletion nulls the reference, retaining
  the name snapshot and shared organization content. Reviews similarly retain
  `authorName` when their author is deleted.
- The server resolves the review's organization from stored data and checks the
  requesting user's current membership on every operation. Client-supplied org,
  review, revision, intent IDs, session active-organization values, and hashes are
  not authorization.
- Mutations serialize with other review mutations and lock the membership row.
  Membership removal/role changes cannot bypass an in-progress authorization
  transaction. Database deadlocks/serialization conflicts return retryable 503.
- Missing or inaccessible organization/resources return 404, not existence-
  revealing permission details. An authenticated member without the necessary
  role receives 403.
- Deduplication, reservations, usage, and download lookups are scoped by org.
  Identical bytes stored in another org are not disclosed or reused.

| Operation | Required permission, in addition to current membership |
|---|---|
| Create a review | Any member; requester becomes author and report owner |
| Push/complete revisions | Review author |
| Read/history/download | Any member |
| Change title/reviewers | Review author |
| Change status/delete | Review author or current organization owner/admin |
| Record seen state | Assigned reviewer |
| Limits/usage for an org | Any member of that org |

Reviewers must be members when added. Their participant rows reference the
membership and cascade when membership ends, producing sync events.
An invalid reviewer assignment returns 404, not 400, without identifying
whether that user exists. Self-assignment remains supported by the backend;
the desktop may hide the author in its picker as a client policy.

### Organization member directory

`GET /api/v1/organizations/:organizationId/members?limit=100&after=...`

Uses the same Bearer-only authentication and current-membership requirement.
Nonmembers and unknown organizations return JSON 404. Responses are no-store,
contain no emails, and include the caller:

```json
{
  "members": [
    { "userId": "user-id", "name": "Example", "username": null, "image": null, "role": "member" }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

Limit defaults to 100, accepts 1–200. Results use database name ordering then
user ID, with keyset cursors bound to the requester and organization. Roles are
owner/admin/member (highest role when membership contains multiple roles).
Malformed or wrong-scope cursors return 400 `invalid_cursor`. Follow nextCursor
while hasMore; concurrent directory changes may require a fresh replay. Returned
userId values are the IDs accepted by reviewerUserIds, subject to membership
still being valid at assignment time.

## Authentication and transport

Base path: `/api/v1/reviews`. Send `Authorization: Bearer <session-token>`.
The existing Better Auth desktop device flow is unchanged.

New routes require an explicit Bearer header, strip browser cookies before
session resolution, and reject missing/invalid/revoked credentials with 401.
They do not accept tokens in query strings. `/api/v1/me` is unchanged.

All API responses use `Cache-Control: no-store`. No wildcard CORS is added.
The intended desktop transport is native/Rust HTTP; WebView fetch would need
separate CORS/CSP and Tauri permission configuration.

All report-related bytes **must** use a private Vercel Blob store. Configure
`REVIEWS_BLOB_READ_WRITE_TOKEN` with the retained private store credential.
Never use the public avatar `BLOB_READ_WRITE_TOKEN`; there is no public fallback.
All operations pass the review token explicitly, and upload/download presigning
requests private access.

Signed URLs are short-lived bearer capabilities, issued only after membership
and resource checks. Already-issued URLs can remain usable until expiry after
membership removal. New reads, URL issuance/renewal, and publication are denied
after removal; already-downloaded files cannot be remotely revoked. Enforcing
membership on every byte transfer would require a separate authorized transfer
service instead of direct Blob URLs. Never forward the website session header
to a storage URL or cross-origin redirect.

## Payloads and limits

`GET /api/v1/reviews/limits[?organizationId=...]` returns:

```json
{
  "apiVersion": 1,
  "manifestSchemaVersions": [1],
  "limits": {
    "manifestBytes": 524288,
    "requestBytes": 589824,
    "reportsPerRevision": 200,
    "reportBlobBytes": 16777216,
    "designBlobBytes": 33554432,
    "bundleBytes": 104857600,
    "blobsPerRevision": 450,
    "reviewersPerReview": 50,
    "orgStorageBytes": 5368709120,
    "uploadUrlTtlSeconds": 300,
    "downloadUrlTtlSeconds": 300
  },
  "transports": ["remote"],
  "bundleEnabled": false
}
```

Enable bundle transport with `REVIEWS_BUNDLES_ENABLED=true`. Limits are fixed
server-enforced v1 values advertised by this endpoint, not unvalidated env
overrides. Organization-specific queries require membership. Without an org,
limits contain deployment capabilities only, not organization data.

The entire JSON request is stream-bounded before parsing, including unknown
envelope fields. Nesting is capped at 32. The manifest is strict recursively;
unknown manifest fields produce 400. Other request envelopes ignore unknown
fields. Bodies must have Content-Type application/json.

Report and optional design payloads are opaque gzip JSON (`application/gzip`).
Bundles use `application/x-git-bundle`. The server validates byte length, media
type, and SHA-256, not report contents or Git reachability. The desktop is
responsible for valid JSON/gzip, bounded decompression, and safe import.
Report assets must be contained in these private payloads; arbitrary external
public URLs are not made private by storing their references here.

## Manifest

```json
{
  "manifestSchemaVersion": 1,
  "client": { "app": "subtubes-desktop", "version": "1" },
  "repo": {
    "key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "remoteUrl": "https://github.com/example/repository"
  },
  "review": {
    "title": "Example change",
    "sourceBranch": "feature",
    "targetBranch": "main"
  },
  "revision": {
    "baseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "commitCount": 1,
    "fileCount": 1
  },
  "code": { "transport": "remote" },
  "reports": [{
    "clientId": "local-report",
    "kind": "commit",
    "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "schemaVersion": 1,
    "title": "Example report",
    "featureCount": 1,
    "issueCount": 0,
    "createdAt": "2026-10-17T00:00:00.000Z",
    "blobs": {
      "report": {
        "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "bytes": 123
      }
    }
  }]
}
```

- Commit hashes are 40 lowercase hex (Git SHA-1 only in v1). Base/head differ.
  Repo key is a client-claimed root SHA grouping hint, not an auth boundary or
  globally guaranteed repo identity. Forks share roots.
- Remote URLs support HTTPS, credential-free SSH URLs, and SCP-style `git@host:org/repo`; SCP syntax is
  normalized to HTTPS. Host casing, trailing slash and `.git` are normalized.
  Embedded credentials, queries, and fragments are rejected, not logged.
- `remote` transport requires remoteUrl. Bundle transport instead supplies:
  `"code": {"transport":"bundle","bundle":{"hash":"<64 hex>","bytes":123,
  "prerequisites":["<40 hex>"]}}`.
- A range report replaces `commit` with
  `"range":{"base":"<40 hex>","head":"<40 hex>","commits":["<40 hex>"]}`
  and uses `"kind":"range"`. Commit lists contain 1–2000 SHAs.
- Optional `blobs.design` has the same hash/bytes shape as `blobs.report`.
- Titles trim to 1–300 chars; branch names have 1–255 chars and no controls.
  Report client IDs are unique within a revision. Counts are nonnegative bounded
  integers. All display counts are untrusted hints.
- Hashes are SHA-256 over the **uploaded compressed/raw bytes**, not expanded
  JSON. Repeated hashes must claim the same size/type. Use deterministic gzip
  if byte-for-byte deduplication is desired.
- The validated, normalized manifest is hashed using recursively sorted JSON
  object keys, compact separators, JS JSON scalar/string encoding, UTF-8, and
  unchanged array ordering. The defined schema has bounded integer numeric
  fields. Cross-language clients should use shared canonicalization fixtures;
  the server is the authority for manifest idempotency.
- Git bundle prerequisites must exist in the receiving clone; the desktop must
  fetch them from a remote or explain missing prerequisites. The server never
  runs Git.

## Endpoints

### Push

`POST /api/v1/reviews/push`

```json
{ "organizationId": "org-id", "manifest": {}, "reviewerUserIds": ["user-id"] }
```

The natural review key is org/repo/source/target/author/cycle. Any member can
create their own review; they cannot push to another author's review.
`cycle` defaults to an empty string; after merging, send an explicit new UUID
cycle to start another review for the same branch pair. Reuse it on retries.
Closed reviews reopen on an author push. Merged reviews are terminal.

A canonical manifest maps to one revision within a review. Concurrent retries
reuse the same revision and active upload intents. Expired/abandoned revisions
can renew their pending lifetime through the same push without duplicating
published history. Reviewers are unioned with current participants.

Response 201 for a new revision or 200 for an existing revision:

```json
{
  "review": { "id": "rev_UUID", "organizationId": "org-id", "authorId": "user-id", "status": "open" },
  "revision": { "id": "rv_UUID", "number": 1, "state": "pending", "expiresAt": "..." },
  "missing": [{
    "hash": "<64 hex>",
    "bytes": 123,
    "contentType": "application/gzip",
    "upload": { "method": "PUT", "url": "<private signed URL>", "headers": { "content-type": "application/gzip" }, "expiresAt": "..." }
  }],
  "limits": {}
}
```

Review/revision responses include their persisted fields. Perform exactly the
returned storage method/URL/headers with raw bytes. Do not add the API session
token. There is no proxied upload route: large bodies bypass Next.js Functions.

Every intent has a unique `reviews/<org>/uploads/<uuid>/<hash>` private path;
upload tokens bind that path, type, maximum size and TTL, with overwrite/suffix
changes disabled. Missing hashes reserve quota once per org. Quota checks and
reservations are transactionally serialized; stale abandoned reservations are
released by cleanup.

No-overwrite retries can return a provider already-exists error after a lost
success response. Proceed to complete to verify existing bytes; if verification
fails, renew the intent after its expiry via push. Storage errors have the
provider's shape, not the API's JSON error schema.

### Complete

`POST /api/v1/reviews/:reviewId/revisions/:revisionNumber/complete`

Author/current-member only. Uses the positive integer revision number, not its
opaque ID. The same `[revisionNumber]` Next.js segment is used by read/complete.

Each completion verifies HEAD metadata and streams SHA-256 for every newly
uploaded payload, including bundles. A verified hash can be reused only within
its org. Incorrect uploads cannot poison another attempt's path. At most eight
objects/100 MiB are processed per call; verified progress is durable.

- 409 `blobs_missing`, with `details.missing` hash strings, when attempted
  objects are absent or fail integrity. Upload/retry before completing again.
- 202 with `verifying:true` when more bounded verification work remains; repeat
  complete. No detached background verification is started.
- 200 with `verifying:false`, review and revision when complete. Repeating
  complete on a completed revision is successful.
- 410 `revision_expired` for expired pending attempts; push the same manifest
  again. Completed revisions never expire.

Latest always points to the highest-numbered complete revision, regardless of
completion order. Nothing is published after membership loss, review deletion,
or merge. Storage/provider work is outside database transactions.

### Read/history and ownership

- `GET /api/v1/reviews/:reviewId`: persisted review fields, `latestRevision`
  (including validated manifest, or null), all complete history entries,
  latest revision's `reports` database records (including organization/owner),
  and assigned `reviewers` with lastSeenRevision.
- `GET /api/v1/reviews/:reviewId/revisions/:revisionNumber`: same response
  envelope with the requested complete revision and its report records. Also
  returns that revision under `revision`.
- `GET /api/v1/reviews/:reviewId/blobs/:hash`: 307 to a short-lived private URL,
  only if that org/hash is verified and referenced by a complete revision of
  that review. Pending/abandoned-only blobs are not downloadable.
- `PUT /api/v1/reviews/:reviewId/seen` with `{"revision":1}`: assigned reviewers
  only, actual complete revision required; seen state advances monotonically.

Detail responses also include a nested `review` containing persisted review
fields; top-level review fields remain for backwards compatibility. History
entries contain id, number, createdAt and completedAt, ordered newest first.
`reviewers` contains userId and lastSeenRevision; unseen is null in the response
(stored as zero internally). Seen returns `{"seen":1}` with the stored maximum.

### Metadata and deletion

`PATCH /api/v1/reviews/:reviewId` accepts title, status, addReviewerUserIds and
removeReviewerUserIds. Author edits title/reviewers; author or org owner/admin
changes status. Status is open/closed/merged; merged sets mergedAt and is terminal.
PATCH returns `{"review":{...}}` plus the same persisted fields at the top level
for backwards compatibility.

`DELETE /api/v1/reviews/:reviewId` returns 202
`{"deleted":true,"storageCleanup":"queued"}`. Database deletion is immediate;
exclusive bytes are removed asynchronously after upload expiry/grace. Do not
interpret 202 as proof the remote bytes have already been erased.

### Sync

`GET /api/v1/reviews?role=reviewer|author|all&status=open|closed|merged|all&organizationId=...&after=...&limit=50`

Defaults: role=reviewer, status=open; limit 1–100. Explicit org filters require
membership. Otherwise events are limited to currently joined organizations.

Response: `{items, nextCursor, hasMore}`. Items are change snapshots with review
metadata, `reviewerUserIds`, latestRevisionId, string seq, and removed=false,
or `{id, organizationId, seq, removed:true}` tombstones. Fetch a review to obtain
its complete manifest/report records.

Events are allocated using a transactionally locked counter, not nextval:
allocation is serialized through commit to avoid skipped late commits. Changes
include publication, metadata, seen and participant changes. The cursor is
opaque, user/filter-bound, bigint-safe and paginated to a fixed high-watermark.
Pages may contain no visible items but still advance the cursor; always follow
hasMore. Consume events in order and apply idempotently (at-least-once delivery,
not an exactly-once network guarantee).

First sync omits after and replays retained events from zero. The change log is
retained in v1 (no cursor/tombstone expiry). Closing a review or removing its
reviewer produces a removal for the old inbox filter. Membership removal also
requires clearing that organization's local data using refreshed `/api/v1/me`;
do not expect revoked org data/tombstones from the API. Adding membership allows
a fresh replay for that org.
Damaged, empty, wrong-user/query, or out-of-range cursors return HTTP 400 with
`error:"invalid_cursor"`. Invalid filters remain `invalid_request`.
Sequences are signed PostgreSQL bigint decimal strings, not JS numbers; examples
larger than 9223372036854775807 are not server-emittable values.

### Usage

`GET /api/v1/reviews/usage?organizationId=...`

Returns storageBytes (verified), reservedBytes (unverified), limitBytes, and
reviewCount. Published content plus active/stale reservations count against the
quota until garbage collection releases them.

## Storage lifecycle and migration

New tables: review, reviewRevision, reviewReport, reviewParticipant, reviewBlob,
reviewRevisionBlob, reviewUpload, reviewClock, reviewChange, reviewGc, reviewRate.
Report envelopes live in JSONB as well as the immutable revision manifest.
The retained generic `blob` table is deliberately separate: new review cleanup
cannot delete avatars or legacy/unrelated objects.

All published manifests and bytes remain until explicit review/org deletion.
There is no automatic closed/merged expiry or latest-three bundle pruning.
Pending revisions expire after 24 hours and become abandoned. Unreferenced blobs
are collected after 48 hours and only once no active upload/reference remains.

Database deletion triggers enqueue storage paths into durable jobs that survive
review, user and organization cascades. Jobs wait at least ten minutes (longer
than issued upload capabilities). Remote deletion happens before acknowledging
the job; failures retain retry state. Expiring leases and SKIP LOCKED claims allow
concurrent cron execution; current verified paths are never removed by duplicate
upload jobs. Active intents must still exist when verification is committed.

`GET /api/cron/reviews-gc` requires the exact `Authorization: Bearer CRON_SECRET`.
An hourly Vercel Cron schedule is included in vercel.json (requires an eligible
Vercel plan). Batches are bounded to 50 storage jobs. No session advisory locks
are used, so Supabase transaction pooling remains supported.

Rate limits are persistent in PostgreSQL: push 30/user/hour; new upload intents
600/user/hour; downloads 300/user/minute; other operations 120/user/minute.
429 responses include Retry-After.

Run Kysely migrations separately from builds. The new migration follows the
guarded legacy-retirement migration; populated legacy production databases may
require the previously documented cleanup first. Never bypass that guard.
Rollback refuses populated reviews/blob/cleanup data.

## Errors, logging and deployment validation

API errors: `{"error":"code","message":"human text","details":{}}`.
Details are optional. Unknown paths under `/api/v1/` return JSON 404
`{"error":"not_found","message":"No such endpoint."}` for supported HTTP verbs,
without cookies, CORS, or cacheability. HEAD has no body by HTTP semantics.
Next.js-generated method-not-allowed responses and platform-level failures may
have different bodies; clients should tolerate these separately.
Codes include invalid_request/invalid_manifest (400), unauthorized (401),
forbidden/bundle_disabled (403), not_found (404), review_merged/blob_conflict/
blobs_missing (409), revision_expired (410), too_large/quota_exceeded (413),
unsupported_media_type (415), rate_limited (429), storage_unavailable/
retry_transaction (503), and internal_error (500).
`invalid_cursor` is HTTP 400.

Do not log raw bodies, SQL/provider errors, session tokens, signing material, or
signed URLs. Unexpected failures log only a correlation ID and sanitized
category. Limits enforced by Vercel or Blob can return platform error shapes.

Tests use the existing node:test runner, isolated local PostgreSQL schemas,
and injected provider fixtures. `REVIEWS_TEST_DATABASE_URL` enables DB tests
and rejects hosted targets. Real private-store credentials are additionally
required before production rollout to verify unsigned URL denial, raw native
PUT, maximum-size uploads, signed GET Range, and attachment/nosniff headers.
Mock tests do not establish real provider policy. Never use production
credentials for fixture-creating tests.

Focused validation:

```bash
REVIEWS_TEST_DATABASE_URL=postgres://...@localhost:5455/disposable_test \
  npx tsx --test tests/reviews-api.test.ts tests/reviews-http.test.ts tests/reviews-storage.test.ts
```

For live route tests, run the app with that isolated database and set
`REVIEWS_TEST_BASE_URL`, `DATABASE_URL`, and the matching Better Auth origin.
The live route test seeds verified metadata only and never contacts Blob;
the service/provider tests cover the upload/verification contract separately.
Set `CRON_SECRET` on the local app to exercise unauthenticated cron rejection.
