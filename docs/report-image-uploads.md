# Report image uploads

Implementation contract; requires the direct-image migration, configured private
Blob store, and deployment before production use. Web reports remain read-only.

## Local processing and identity

The desktop saves images up to **2 MiB (2,097,152 bytes)** and **16,384 pixels per
side**, accepting PNG, JPEG, WebP and GIF. Newly added still images larger than
2 MiB are optimized before saving/hashing: preserve aspect ratio, cap the long
side at 4096, try PNG and WebP at quality 0.92/0.85, then at 85%/70% of that
resolution. Failure is explicit rather than unlimited quality degradation.
Source processing is capped at 20 MiB and 40 million pixels. Oversized animations
are rejected rather than silently flattened. Small images are not re-encoded.
Native validation remains authoritative; MCP file uploads must already fit.

Existing image bytes, report snapshots, hashes and pending document envelopes
are never rewritten automatically. Oversized historical references require
explicit replacement in editable content; immutable snapshots cannot be changed.
Missing, corrupt or oversized references block desktop publication.

## Capabilities and upload protocol

All control endpoints are under `/api/v1/organizations/{orgId}` and require
account authentication and organization membership. `/limits` advertises:

```json
{
  "directImageUploads": true,
  "maxBlobBytes": 2097152,
  "maxImageSide": 16384,
  "imageUploadConcurrency": 3
}
```

Only use the direct protocol when explicitly advertised. Desktop retains the
legacy raw PUT path for older servers, under the stricter local byte limit.

1. Check `/blobs/missing` with hash batches of at most 500.
2. For each missing image, `POST /blobs/uploads`:

```json
{
  "hash": "<64 lowercase SHA-256 hex characters>",
  "contentType": "image/png",
  "byteSize": 12345,
  "resource": { "kind": "report", "id": "<cloud report ID>" }
}
```

`resource.kind` is `report` or `design`. Existing destinations must belong to
the caller and organization. New IDs are allowed because reports publish last.
The server keeps resource association, expected hash/MIME/size, owner, expiry,
and storage path in `blobUpload`. This is an upload intent, not a ready image or
a partially published report.

The response is either `{ "state": "ready", "hash": "..." }` or:

```json
{
  "state": "upload",
  "uploadId": "<UUID>",
  "pathname": "report-images/<organizationId>/<uploadId>/<hash>",
  "clientToken": "<restricted client token>",
  "access": "private",
  "expiresAt": "<ISO timestamp>"
}
```

3. Use `put` from `@vercel/blob/client` with that pathname, private access,
declared content type and client token. Image bytes go directly to Vercel Blob.
Never send the account session token to storage or expose a store read-write
token. The client token is signed, lasts 15 minutes, forbids overwriting, and
restricts pathname, MIME and size. The signed pathname binds organization,
upload intent and expected hash; resource metadata is persisted server-side,
not trusted from an arbitrary client URL or callback.
4. `POST /blobs/uploads/{uploadId}/complete` with an empty JSON body. The caller
must own the intent and still belong to its organization. The server reads the
private object by its stored path with a strict byte budget, checks exact byte
size, SHA-256, actual format and dimensions, then atomically registers a ready
`blob` and completes the intent. The response is
`{ "state": "ready", "hash": "..." }`.

No unverified upload enters `blob`, `/blobs/missing` results, or reference
validation. Completion is idempotent and concurrent completion deduplicates by
organization/hash. Expired unfinished intents return `410 upload_expired`;
request a new authorization for the same unchanged bytes. Partial successful
uploads remain ready and are skipped on retry.

## Publication and reads

Desktop uploads up to three independent images concurrently. On failure it
stops admitting new work, waits for active work to settle, and does not publish
the report. All images must be ready before designs/snapshots/report publication.
Each walkthrough step retains its image hash; frozen design Markdown and preview
hashes remain in report content. All image references, including `shots`, must
appear in that document's `refs.blobs` and exist in the authorized organization.
This preserves report association without embedding binary data in report JSON.

For report creation, the existing backend also accepts `If-Match: *` as a
create-only guard and returns 409 if the report already exists. Desktop uses
this form because the hosted response layer can convert `If-None-Match: *`
into a bodyless 304 on PUT. Updates still require the exact prior numeric revision.

New blobs store private storage paths, MIME, bytes, width and height rather than
binary data in PostgreSQL. Existing blobs keep their original `data`; reads
support both representations. GET image endpoints remain authenticated and
return bytes, never redirect users to public Blob URLs.

## Deployment and operational limits

- Use a separate private store via `REPORT_BLOB_READ_WRITE_TOKEN`, with separate
  development/preview/production stores. Public avatars still use their own token.
- Apply migration before deploying API code. No historical byte migration occurs.
- Rollback refuses to drop external storage metadata while external images exist;
  recover their exact bytes into PostgreSQL before rolling back.
- Direct uploads remove binary request traffic from functions, but finalization
  and authorized downloads still read at most 2 MiB through the backend.
- Expired/uncompleted storage objects and duplicate concurrent intents are not
  automatically pruned in this release. Configure a retention/cleanup process
  before large-scale rollout; do not delete objects referenced by ready blobs.
  Organization deletion currently cascades database rows, not external objects.
- Storage access uses the SDK; failures are logged and surfaced explicitly.
- Local integration tests use isolated PostgreSQL schemas and synthetic storage
  providers/loopback SDK transport. A real private-store smoke test is a separate
  deployment verification requirement.
