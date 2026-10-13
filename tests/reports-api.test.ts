import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

test("reports API endpoints reject unauthenticated requests", async () => {
  const { GET: getReports } = await import(
    "@/app/api/v1/organizations/[orgId]/reports/route"
  );
  const req = new Request("http://localhost:3000/api/v1/organizations/org-123/reports");
  const res = await getReports(req, { params: Promise.resolve({ orgId: "org-123" }) });
  assert.ok(res);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error.code, "unauthenticated");
});

test("report detail endpoint rejects unauthenticated requests", async () => {
  const { GET: getReport } = await import(
    "@/app/api/v1/organizations/[orgId]/reports/[reportId]/route"
  );
  const req = new Request("http://localhost:3000/api/v1/organizations/org-123/reports/rep-1");
  const res = await getReport(req, {
    params: Promise.resolve({ orgId: "org-123", reportId: "rep-1" }),
  });
  assert.ok(res);
  assert.equal(res.status, 401);
});

test("snapshot endpoint rejects unauthenticated requests", async () => {
  const { GET: getSnapshot } = await import(
    "@/app/api/v1/organizations/[orgId]/reports/[reportId]/snapshots/[number]/route"
  );
  const req = new Request("http://localhost:3000/api/v1/organizations/org-123/reports/rep-1/snapshots/1");
  const res = await getSnapshot(req, {
    params: Promise.resolve({ orgId: "org-123", reportId: "rep-1", number: "1" }),
  });
  assert.ok(res);
  assert.equal(res.status, 401);
});

test("blob endpoint rejects unauthenticated requests", async () => {
  const { GET: getBlob } = await import(
    "@/app/api/v1/organizations/[orgId]/blobs/[sha256]/route"
  );
  const fakeSha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const req = new Request(`http://localhost:3000/api/v1/organizations/org-123/blobs/${fakeSha}`);
  const res = await getBlob(req, {
    params: Promise.resolve({ orgId: "org-123", sha256: fakeSha }),
  });
  assert.ok(res);
  assert.equal(res.status, 401);
});
