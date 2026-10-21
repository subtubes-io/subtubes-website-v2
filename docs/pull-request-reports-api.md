# Pull-request reports API

The website side of the contract the desktop app defines in `src/pullRequests/remote/contract.ts` and
`docs/remote-pull-request-api.md` (Subtubes desktop repository). The request and response shapes, the error codes and the check order are
those documents'; this page is what this website does with them and where it chooses.

Everything is under `/api/v1/organizations/{organizationId}/pull-request-reports`, with `Authorization: Bearer <session token>` (only the
header counts; a cookie is ignored). `POST` publishes, `GET` lists, `GET /{reportId}` reads, `DELETE /{reportId}` deletes, and `POST /move` files a repository's reports under another.

A report carries no code. It is the write-up and the list of files (path, status, counts, language); the desktop app generates the diffs
itself from its own git checkout. A report is filed under its **repository**, the key `host/owner/repo` (lowercase, no scheme, credentials,
port or `.git`; see `lib/pull-request-reports/repository-key.ts`, which the desktop app mirrors, and both run `tests/fixtures/repository-key-vectors.json`).

## Order of checks

1. Bearer session, else `401`.
2. The organization id in the path is well formed, else `400`.
3. The person is a member, else `404 organization-not-found` (the same answer as for an organization that does not exist).
4. Publish only: `Content-Type: application/json` (`415`), a valid `Idempotency-Key` (`400`), the size while reading (`413`), then the
   validation below (`400`, `422`).

Nothing is read from the body before step 4. Rate limiting is not implemented yet.

## Validation of a published report

`lib/pull-request-reports/validate.ts` is the only way a body is accepted; `schema.ts` is the format. Nothing that fails is stored.

- The body is at most 4 250 000 bytes, valid UTF-8, and valid JSON.
- No string or key holds a null character or a lone surrogate (PostgreSQL cannot store them), no key is `__proto__`, and nesting is at most 64 deep.
- A `bundle.schemaVersion` that is not accepted (currently `3` and `4`) is `422 unsupported-schema-version` with `details.supported`.
- Every object is strict: a key the format does not list, at any depth, is refused. Every field is checked for type, enum, pattern and range,
  including the **diagram** and each **scenario** in `bundle.design`, which are checked against the app's own diagram and scenario formats
  (unique ids, edges between existing nodes, a scenario's start and branches pointing at existing steps). A diagram carries its own
  `schemaVersion`; versions **1 and 2** are accepted. Version 2 adds an optional `color` on nodes, groups and edges (a preset name:
  `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `gray`; or `#rrggbb`) and makes `layer` optional. A `color` in a
  version 1 diagram is refused.
- The document must agree with itself: the commit, file, addition and deletion counts match, the design is at the branch's head, files, commits,
  commit reports and scenarios have unique ids, and the reports a commit points at exist.
- The app's limits are enforced again: at most 100 commits, 300 files, a path at most 4 096 characters. A file's text or changes are not accepted at all.
- `repository` is required, and `repository.remote` must be an `https`, `http`, `ssh` or `git` URL, or `user@host:path`, with a host and at least an owner and a repository in the path (so it has a key). Credentials, a query and a fragment are removed
  before it is stored (`ssh://git@…` and `git@host:path` keep the conventional `git` user).

A refusal is `422 invalid-report` with up to 20 `details.issues` (`path` is dotted from the body, for example `bundle.files.0.status`).

A scenario step at a diagram node that is not in the diagram is accepted: the app's format allows a scenario to outlive a node, and its own
check for that runs only when a scenario is written.

## Listing by repository, and moving

`GET …/pull-request-reports?repository=github.com/acme/payments` lists only that repository's reports (it combines with `createdBy`, `limit` and
`cursor`; a value that is not a key is `400`). Every summary carries `repositoryKey`.

`POST …/pull-request-reports/move` with `{ "from": "<key>", "to": { "name", "remote" } }` is for a project whose git remote changed. It changes the
repository of the organization's reports under `from` and nothing else, in one statement, and answers `{ moved, skipped }`. A member moves the
reports they published; an owner or admin moves all of them. The reports a caller may not change are left and counted in `skipped`. The body is
at most 4 096 bytes.

## Storage

Table `pullRequestReport` (`migrations/20261020000000_pull_request_reports.ts`, and `20261021000000_pull_request_report_repository.ts` for `repositoryKey` and its index): the document as `jsonb`, and the fields the list shows as columns
so a list never opens a document. The id is `rpt_` and 12 random characters. `createdAt` is the website's clock.

- **Idempotency:** unique on (organization, publisher, key); the body's SHA-256 is compared on a repeat. The row goes with the report, so a
  deleted report's key can be used again for a new report.
- **Retention:** a report is kept until it is deleted, or until its organization or its publisher's account is deleted (both cascade).
- **Who sees what:** every member reads every report. The publisher shows as `{ id, name, image }`, never an email address.
- **Paging:** newest first by `createdAt`, then `id`; the cursor is opaque.

## Managing reports on the website

`/dashboard/organizations/{slug}/reports` (linked from the organization page) lists the organization's reports newest first, up to 100: title,
repository, branch, size of the change, who published it, when, and the size of the document. It is for managing, not reading: there is no way to open a
report there. A member sees every report and can delete their own; an owner or admin can delete any, after a confirmation.

The delete is `DELETE /api/organizations/{organizationId}/pull-request-reports/{reportId}` with the browser session (cookie), which also needs
the website's own origin. It is the same deletion as the bearer API's, with the same rules and answers.

## Tests

`npm test` runs `tests/pull-request-validation.test.ts` (no server needed) and `tests/pull-request-reports-api.test.ts` (needs `npm run dev` and
the local database, like the other API tests). The fixture is the desktop repository's `docs/api/pull-request-reports/examples/publish-request.json`;
copy it again when the contract changes.
