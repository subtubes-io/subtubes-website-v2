import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { reportFixture } from "../../report-ui/src/fixtures";

const fixture = randomUUID();
const email = `compatibility-${fixture}@example.test`;
const password = randomUUID();
const slug = `compatibility-${fixture}`;
const reportIds = [randomUUID(), randomUUID(), randomUUID()];
let organizationId: string;
const before = process.env.COMPATIBILITY_CAPTURE_BEFORE === "1";

test.beforeAll(async ({ request }) => {
  const connection = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(connection.hostname);
  const signup = await request.post("/api/auth/sign-up/email", { data: { email, password, name: "Compatibility reviewer" } });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const userId = (await signup.json()).user.id;
  const organization = await request.post("/api/auth/organization/create", {
    data: { name: "Document compatibility examples", slug },
  });
  expect(organization.ok(), await organization.text()).toBeTruthy();
  organizationId = (await organization.json()).id;
  const pool = new Pool({ connectionString: connection.toString() });
  try {
    for (const [index, name] of ["Supported report", "Future report", "Corrupt report"].entries()) {
      const content = { ...reportFixture(), title: name, narrative: "Synthetic compatibility fixture." };
      await pool.query(`insert into report
        (id,"organizationId","ownerId","projectName","schemaVersion",revision,"contentHash",report,refs,"updatedAt")
        values ($1,$2,$3,$4,$5,1,'fixture-hash',$6,'{"blobs":[],"designs":[]}',now())`,
      [reportIds[index], organizationId, userId, name, index === 1 ? 3 : 2, index === 2 ? "broken" : JSON.stringify(content)]);
    }
  } finally {
    await pool.end();
  }
});

test.afterAll(async ({ request }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('delete from organization where slug=$1', [slug]);
    const login = await request.post("/api/auth/sign-in/email", { data: { email, password } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const deleted = await request.post("/api/auth/delete-user", { data: { password } });
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
  } finally {
    await pool.end();
  }
});

test("document compatibility library, content guards and cloning a report", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const login = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(name, { path, contentType: "image/png" });
  };
  await page.goto(`/dashboard/organizations/${slug}`);
  await expect(page.getByRole("heading", { name: "Document compatibility examples", exact: true })).toBeVisible();
  await expect(page.getByText("Supported report", { exact: true })).toBeVisible();
  if (!before) {
    await expect(page.getByText("Requires a newer app", { exact: true })).toBeVisible();
    await expect(page.getByText("Invalid document", { exact: true })).toBeVisible();
    const future = page.locator('[data-id]').filter({ hasText: "Future report" });
    await expect(future.getByRole("link", { name: "View" })).toHaveCount(0);
    await expect(future.getByRole("button", { name: "Clone" })).toHaveCount(0);
  }
  await capture("mixed-library");
  await page.goto(`/dashboard/organizations/${slug}/reports/${reportIds[1]}`);
  if (!before) {
    await expect(page.getByRole("heading", { name: "Requires a newer app", exact: true })).toBeVisible();
    await expect(page.getByText("Wire schema 3", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clone report" })).toHaveCount(0);
  } else {
    await expect(page.getByLabel("Snapshots")).toBeVisible();
  }
  await capture("unsupported-detail");
  await page.goto(`/dashboard/organizations/${slug}/reports/${reportIds[2]}`);
  if (!before) await expect(page.getByRole("heading", { name: "Invalid document", exact: true })).toBeVisible();
  else await expect(page.getByText("This page could not be found.")).toBeVisible();
  await capture("invalid-detail");
  await page.goto(`/dashboard/organizations/${slug}/reports/${reportIds[0]}`);
  if (!before) {
    await expect(page.getByLabel("Snapshots")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clone report", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supported report", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clone report", exact: true }).click();
    await page.waitForURL((url) => url.pathname.includes("/reports/") && !url.pathname.endsWith(reportIds[0]));
    await expect(page.getByRole("heading", { name: "Copy of Supported report", exact: true })).toBeVisible();
    const copyId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
    expect(copyId).not.toBe(reportIds[0]);
    await capture("cloned-report");
    await page.goto(`/dashboard/organizations/${slug}`);
    await expect(page.locator("[data-id]").filter({ hasText: "Copy of Supported report" })).toHaveCount(1);
    const original = page.locator(`[data-id="${reportIds[0]}"]`);
    await original.getByRole("button", { name: "Clone" }).click();
    await expect(page.locator("[data-id]").filter({ hasText: "Copy of Supported report" })).toHaveCount(2);
    const gone = await page.request.get(`/api/organizations/${slug}/reports/${reportIds[0]}/snapshots/1`);
    expect(gone.status()).toBe(404);
  } else {
    await expect(page.getByLabel("Snapshots")).toBeVisible();
  }
  await capture("report-clone");
});
