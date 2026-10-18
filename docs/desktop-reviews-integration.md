# Desktop reviews integration guide

This is the Tauri client implementation checklist for the
[private reviews API v1](reviews-api-spec.md). That specification is the
authoritative wire contract; this guide describes how to consume it.
Authentication is documented in [desktop authentication](desktop-api-integration.md).
No desktop implementation is included in this repository.

## Compatibility and rollout

The backend supports organization-scoped report sharing, immutable revisions,
reviewer synchronization, and private downloads. It is not a raw JSON report
POST API: publishing requires a manifest and gzip JSON payloads.

An existing desktop client using the retired report/design APIs must adapt to
this contract. Compatibility with a particular desktop build requires testing
that build; backend tests alone do not establish desktop compatibility.

The new backend has not been deployed or migrated in production as part of this
work. Before enabling a desktop release:

- Apply the Kysely migrations, respecting the legacy-retirement guard.
- Configure the private review store and authenticated cleanup cron.
- Verify real private Blob unsigned-access denial, native signed PUT/GET,
  maximum payload sizes, Range behavior, and download response headers.
- Run the desktop acceptance checks below against an isolated test deployment.

Do not infer deployed review support from working device login alone.

## 1. Sign in and choose an organization

1. Complete the existing device authorization flow. Store the session token in
   the OS credential store, not browser local storage, logs, or project files.
2. Fetch `/api/v1/me` and offer only its returned organizations.
3. Store the selected organization ID explicitly. Do not rely on a browser's
   active organization or use an organization slug as the API ID.
4. Fetch `/api/v1/reviews/limits?organizationId=<id>` before preparing uploads.
   Respect advertised byte/count limits and enabled transports. Bundle transport
   is disabled unless the server advertises it.
   Numeric examples in desktop documents are illustrative: use the limits the
   server returns, including the five-minute upload URL lifetime.

Populate the reviewer picker from
`GET /api/v1/organizations/:organizationId/members`, following its opaque cursor
until hasMore is false. Display name/username; email is not returned. The client
may hide itself, but self-assignment is not forbidden by the backend.

Use native/Rust HTTP for review requests. These endpoints do not enable
cross-origin WebView fetch. Configure the desktop's networking permissions
without exposing database or Blob read-write credentials.

## 2. Prepare and publish a revision

1. Serialize each report JSON and optional design JSON, then gzip each payload.
   Include assets in the private payloads rather than depending on public URLs.
2. Compute SHA-256 and byte length over the exact compressed bytes that will be
   uploaded. Keep those bytes unchanged throughout retries; deterministic gzip
   is recommended.
3. Construct a manifest using the exact field names and validation rules in the
   API specification. Keep report `clientId` values unique within a revision.
   Do not send an owner ID: the server records the authenticated uploader.
4. POST `/api/v1/reviews/push` with `organizationId`, `manifest`, and optional
   `reviewerUserIds`. Reviewers must currently belong to that organization.
5. Persist the returned review ID and revision **number**, not just the opaque
   revision ID. Completion/history URLs use the number.
6. For each `missing` entry, send its exact raw payload using the returned
   upload method, URL, and headers. Do not use multipart encoding or attach the
   website session token. Bound client upload concurrency.
7. POST `/api/v1/reviews/:reviewId/revisions/:revisionNumber/complete`.
   If the push already returned a complete revision and no missing blobs,
   publication is already finished.
8. Treat completion HTTP 202 with `verifying:true` as incomplete work. Repeat
   completion with bounded backoff until HTTP 200 and `verifying:false`.
   Never show a successful PUT alone as a published report.

Retries of the same normalized manifest reuse its revision. Persist the
manifest, payloads, and optional cycle UUID for reliable recovery after restart.
Do not regenerate payload bytes or change incidental manifest fields on each
retry.

Only the author can push or complete revisions. A merged review cannot accept
new revisions; explicitly begin a new cycle using a new UUID in the push
envelope and reuse that UUID for retries. A closed review reopens on author push.

## 3. Recover from failures

| Response | Desktop action |
|---|---|
| API 401 | Stop authenticated work and require sign-in; do not treat it as empty data. |
| API 403 | Show the permission or disabled-capability error; do not retry blindly. |
| API 404 | Resource is missing or inaccessible. Refresh membership and reconcile local state. Unknown API paths also return JSON 404; use `/limits` capability discovery rather than assuming every JSON 404 proves review support. |
| 409 `blobs_missing` | Inspect `details.missing`, upload missing payloads, then complete again. Renew expired intents through the same push. |
| 409 `blob_conflict` | Check digest/size/type claims against the exact bytes. Do not silently replace them. |
| 409 `review_merged` | Require an explicit new review cycle, not an automatic endless retry. |
| 410 `revision_expired` | Push the same manifest again to renew the pending attempt. |
| 413 | Show the advertised payload or organization quota limitation. |
| 429 | Respect `Retry-After` and avoid retry storms. |
| 503 or transient network failure | Retry with bounded exponential backoff; honor `Retry-After` when present. |

Direct Blob responses have provider-specific shapes, not API JSON errors.
After a lost PUT response, a no-overwrite retry may report already-exists:
attempt completion to verify the object. If integrity fails and the object
cannot be overwritten, renew the upload intent after expiry through push.
Keep signed URLs transient and redact them from diagnostics.

## 4. Synchronize the inbox

1. Partition local records and cursors by account, organization, role, and status.
   Never reuse a cursor with another query or user.
2. Request `/api/v1/reviews` with the selected filters and no `after` on first
   sync. Use `role=all` for an organization-wide view; the default is the current
   user's reviewer inbox with open status.
3. Apply each page in sequence. Upsert present snapshots and remove tombstoned
   IDs from that filtered view. A filter-exit tombstone is not necessarily a
   server-side deletion; other local views may still contain the review.
4. Fetch review details to obtain manifests, report ownership records, and
   reviewer state. Change snapshots are not full report payloads.
5. Atomically persist applied changes and `nextCursor`. On failure, replay the
   previous cursor idempotently. Treat `seq` as a string or 64-bit integer,
   never a JavaScript Number.
6. Follow `hasMore` even when `items` is empty. After the last page, retain its
   cursor for the next poll. Use a bounded polling interval/backoff.
7. On `invalid_cursor` HTTP 400, discard that query's cursor and rebuild its
   filtered view from a fresh replay; surface repeated failures.

Detail and PATCH responses include a nested `review`; detail retains top-level
metadata too. Specific-revision reads include both `revision` and
`latestRevision` for that requested revision. History lists all complete
revisions with createdAt; unseen reviewer state is null. These are confirmed
wire shapes, not inferred client defaults.

Refresh `/api/v1/me` periodically and after access errors. When membership
ends, stop that organization's queued work and clear its local records,
payload cache, and cursors. Revoked organizations do not deliver cleanup
tombstones. Newly joined organizations need a fresh organization-specific
replay, even if an existing cross-organization cursor is already caught up.

## 5. Download, read, and record seen state

Fetch the desired complete revision, then request its payload hashes through
`/api/v1/reviews/:reviewId/blobs/:hash`. The API returns HTTP 307.
Handle the redirect explicitly or use a client policy that never forwards the
website Authorization header to a different origin. Follow the signed storage
URL without the website token; do not send the API's cookies either.

Verify downloaded length and SHA-256 against the manifest before import.
Decompress with output-size/resource limits, validate the report schema, and
treat report text and Git bundles as untrusted content. The backend does not
validate expanded JSON or run Git. Do not assume Range/resume support until the
private provider checks have passed.

After an assigned reviewer successfully opens a complete revision, PUT
`/api/v1/reviews/:reviewId/seen` with its revision number. Persist the server's
returned `seen` value; it may already be higher because seen state is monotonic.

Already-issued storage URLs can remain usable for up to five minutes after
membership loss. Client cache deletion is a local policy, not remote revocation
of bytes a user already downloaded.

## Desktop acceptance checklist

- Device login, session revocation, and organization selection work natively.
- Upload, completion, and download round-trip the original report JSON.
- Repeated push and restart recovery do not create duplicate revisions.
- Expired URLs, missing/incorrect uploads, completion 202, and quota errors
  recover without false publication success.
- Nonmembers cannot read, push, complete, or download across organizations.
- Report ownership matches the signed-in uploader, not supplied client data.
- Inbox pagination handles empty pages, replay, status changes, reviewer removal,
  explicit deletion, membership loss, and newly joined organizations.
- Cross-origin downloads never disclose the website token.
- No report payloads or signed URLs enter logs or public storage.
