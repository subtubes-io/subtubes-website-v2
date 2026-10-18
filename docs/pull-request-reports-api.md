# Pull-request reports API

The website side of the contract the desktop app defines in `src/pullRequests/remote/contract.ts` and
`docs/remote-pull-request-api.md` (Subtubes desktop repository). The request and response shapes, the error codes and the check order are
those documents'; this page is what this website does with them and where it chooses.

Everything is under `/api/v1/organizations/{organizationId}/pull-request-reports`, with `Authorization: Bearer <session token>` (only the
header counts; a cookie is ignored). `POST` publishes, `GET` lists, `GET /{reportId}` reads, `DELETE /{reportId}` deletes.

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
- A `bundle.schemaVersion` that is not accepted (today `2`) is `422 unsupported-schema-version` with `details.supported`.
- Every object is strict: a key the format does not list, at any depth, is refused. Every field is checked for type, enum, pattern and range,
  including the **diagram** and each **scenario** in `bundle.design`, which are checked against the app's own diagram and scenario formats
  (unique ids, edges between existing nodes, a scenario's start and branches pointing at existing steps).
- The document must agree with itself: the commit, file, addition and deletion counts match, the design is at the branch's head, files, commits,
  commit reports and scenarios have unique ids, and the reports a commit points at exist.
- The app's limits are enforced again: at most 100 commits, 300 files, a file's text at most 400 000 bytes, a path at most 4 096 characters.
- `repository.remote` must be an `https`, `http`, `ssh` or `git` URL, or `user@host:path`. Credentials, a query and a fragment are removed
  before it is stored (`ssh://git@…` and `git@host:path` keep the conventional `git` user).

A refusal is `422 invalid-report` with up to 20 `details.issues` (`path` is dotted from the body, for example `bundle.files.0.status`).

A scenario step at a diagram node that is not in the diagram is accepted: the app's format allows a scenario to outlive a node, and its own
check for that runs only when a scenario is written.

## Storage

Table `pullRequestReport` (`migrations/20261020000000_pull_request_reports.ts`): the document as `jsonb`, and the fields the list shows as columns
so a list never opens a document. The id is `rpt_` and 12 random characters. `createdAt` is the website's clock.

- **Idempotency:** unique on (organization, publisher, key); the body's SHA-256 is compared on a repeat. The row goes with the report, so a
  deleted report's key can be used again for a new report.
- **Retention:** a report is kept until it is deleted, or until its organization or its publisher's account is deleted (both cascade).
- **Who sees what:** every member reads every report. The publisher shows as `{ id, name, image }`, never an email address.
- **Paging:** newest first by `createdAt`, then `id`; the cursor is opaque.

## Managing reports on the website

`/dashboard/organizations/{slug}/reports` (linked from the organization page) lists the organization's reports newest first, up to 100: title,
branch, size of the change, who published it, when, and the size of the document. It is for managing, not reading: there is no way to open a
report there. A member sees every report and can delete their own; an owner or admin can delete any, after a confirmation.

The delete is `DELETE /api/organizations/{organizationId}/pull-request-reports/{reportId}` with the browser session (cookie), which also needs
the website's own origin. It is the same deletion as the bearer API's, with the same rules and answers.

## Tests

`npm test` runs `tests/pull-request-validation.test.ts` (no server needed) and `tests/pull-request-reports-api.test.ts` (needs `npm run dev` and
the local database, like the other API tests). The fixture is the desktop repository's `docs/api/pull-request-reports/examples/publish-request.json`;
copy it again when the contract changes.
