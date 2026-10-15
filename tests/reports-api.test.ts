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

test("clone endpoints reject unauthenticated requests", async () => {
  const { POST: cloneReport } = await import(
    "@/app/api/v1/organizations/[orgId]/reports/[reportId]/clone/route"
  );
  const reportResponse = await cloneReport(
    new Request("http://localhost:3000/api/v1/organizations/org-123/reports/rep-1/clone", { method: "POST" }),
    { params: Promise.resolve({ orgId: "org-123", reportId: "rep-1" }) },
  );
  assert.ok(reportResponse);
  assert.equal(reportResponse.status, 401);
  const { POST: cloneDesign } = await import(
    "@/app/api/v1/organizations/[orgId]/designs/[designId]/clone/route"
  );
  const designResponse = await cloneDesign(
    new Request("http://localhost:3000/api/v1/organizations/org-123/designs/des-1/clone", { method: "POST" }),
    { params: Promise.resolve({ orgId: "org-123", designId: "des-1" }) },
  );
  assert.ok(designResponse);
  assert.equal(designResponse.status, 401);
});

test("the retired snapshot, version and status routes no longer exist", async () => {
  for (const route of [
    "@/app/api/v1/organizations/[orgId]/reports/[reportId]/snapshots/[number]/route",
    "@/app/api/v1/organizations/[orgId]/reports/[reportId]/status/route",
    "@/app/api/v1/organizations/[orgId]/designs/[designId]/versions/route",
    "@/app/api/v1/organizations/[orgId]/designs/[designId]/preferred/route",
  ]) await assert.rejects(import(route), `${route} should be gone`);
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
