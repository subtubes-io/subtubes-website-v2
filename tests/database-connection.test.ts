import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseConnectionConfig } from "../lib/db/connection";

test("preserves local and URL-managed connections without an explicit CA", () => {
  const url = "postgres://user:password@localhost:5455/subtubes";
  assert.deepEqual(databaseConnectionConfig(url, ""), { connectionString: url });
  const tlsUrl = `${url}?sslmode=verify-full`;
  assert.deepEqual(databaseConnectionConfig(tlsUrl, ""), { connectionString: tlsUrl });
});

test("uses the configured CA with certificate and hostname verification", () => {
  const config = databaseConnectionConfig(
    "postgres://user:password@db.example.com:6543/postgres?sslmode=verify-full&application_name=subtubes",
    "test-ca",
  );
  const url = new URL(config.connectionString!);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.get("application_name"), "subtubes");
  assert.deepEqual(config.ssl, { ca: "test-ca", rejectUnauthorized: true });
});

test("rejects insecure or conflicting URL SSL options with an explicit CA", () => {
  for (const query of ["", "?sslmode=disable", "?sslmode=require"]) {
    assert.throws(
      () => databaseConnectionConfig(`postgres://user:password@db.example.com/postgres${query}`, "test-ca"),
      /requires sslmode=verify-full/,
    );
  }
  for (const key of ["ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    assert.throws(
      () => databaseConnectionConfig(`postgres://user:password@db.example.com/postgres?sslmode=verify-full&${key}=value`, "test-ca"),
      /cannot be combined/,
    );
  }
});
