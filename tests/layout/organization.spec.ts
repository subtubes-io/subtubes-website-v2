import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";

const fixture = randomUUID();
const password = randomUUID();
const ownerEmail = `org-owner-${fixture}@example.test`;
const memberEmail = `org-member-${fixture}@example.test`;
const recipientEmail = `org-recipient-${fixture}@example.test`;
const outsiderEmail = `org-outsider-${fixture}@example.test`;
const slug = `organization-${fixture}`;
let organizationId: string;
let otherId: string;

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  for (const [email, name] of [
    [memberEmail, "Example member"], [recipientEmail, "Invitation recipient"],
    [outsiderEmail, "Outside user"], [ownerEmail, "Workspace owner"],
  ]) {
    const response = await request.post("/api/auth/sign-up/email", { data: { email, name, password } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await signIn(request, ownerEmail);
  for (const [name, orgSlug] of [["Example workspace", slug], ["Other workspace", `${slug}-other`]]) {
    const response = await request.post("/api/auth/organization/create", { data: { name, slug: orgSlug } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const data = await response.json();
    if (orgSlug === slug) organizationId = data.id;
    else otherId = data.id;
  }
  const invite = await request.post("/api/auth/organization/invite-member", {
    data: { organizationId, email: memberEmail, role: "member" },
  });
  expect(invite.ok(), await invite.text()).toBeTruthy();
  await signIn(request, memberEmail);
  const accepted = await request.post("/api/auth/organization/accept-invitation", {
    data: { invitationId: (await invite.json()).id },
  });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
});

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('DELETE FROM "organization" WHERE "slug" = ANY($1::text[])', [[slug, `${slug}-other`]]);
    await pool.query('DELETE FROM "user" WHERE "email" = ANY($1::text[])', [
      [ownerEmail, memberEmail, recipientEmail, outsiderEmail],
    ]);
  } finally {
    await pool.end();
  }
});

for (const width of [1440, 390]) {
  test(`organization workspace at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page.request, ownerEmail);
    await page.goto(`/dashboard/organizations/${slug}`);
    await expect(page.getByRole("heading", { name: "Example workspace", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu for Workspace owner" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const path = testInfo.outputPath("organization.png");
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach("organization", { path, contentType: "image/png" });
  });
}

test("member tables and invitation lifecycle stay organization-scoped", async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page.request, ownerEmail);
  const activeOrganization = await page.request.post("/api/auth/organization/set-active", { data: { organizationId: otherId } });
  expect(activeOrganization.ok(), await activeOrganization.text()).toBeTruthy();
  await page.goto(`/dashboard/organizations/${slug}`);
  const members = page.getByRole("table", { name: "Members", exact: true });
  const invitations = page.getByRole("table", { name: "Invitations", exact: true });
  await expect(members).toContainText("Workspace owner");
  await expect(members).toContainText("Example member");
  await expect(invitations).toContainText("accepted");
  await page.getByLabel("Invite email").fill(recipientEmail);
  await page.getByLabel("Invitation role").selectOption("admin");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation created" })).toBeVisible();
  const row = invitations.getByRole("row").filter({ hasText: recipientEmail });
  await expect(row).toContainText("pending");
  await expect(row).toContainText("admin");
  const link = row.getByRole("link", { name: "Invitation link" });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/invitations\/.+/);
  const invitationId = href!.split("/").pop()!;
  const active = await page.request.get("/api/auth/get-session");
  expect((await active.json()).session.activeOrganizationId).toBe(otherId);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await row.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation link copied." })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3000${href}`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const path = testInfo.outputPath(`pending-${width}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(`pending-${width}`, { path, contentType: "image/png" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
  });
  try {
    const recipient = await context.newPage();
    await recipient.goto(href!);
    await expect(recipient).toHaveURL(/\/sign-in\?next=/);
    await signIn(recipient.request, outsiderEmail);
    await recipient.goto(href!);
    await expect(recipient.getByText("This invitation is for a different email address.")).toBeVisible();
    const denied = await recipient.request.post("/api/auth/organization/accept-invitation", { data: { invitationId } });
    expect(denied.ok()).toBeFalsy();
    await signIn(recipient.request, memberEmail);
    const cancelDenied = await recipient.request.post("/api/auth/organization/cancel-invitation", { data: { invitationId } });
    expect(cancelDenied.ok()).toBeFalsy();
    await signIn(recipient.request, recipientEmail);
    await recipient.goto(href!);
    await expect(recipient.getByRole("heading", { name: "Join Example workspace" })).toBeVisible();
    await recipient.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(recipient).toHaveURL(`/dashboard/organizations/${slug}`);
    await expect(recipient.getByRole("table", { name: "Members", exact: true })).toContainText("Invitation recipient");
    const replay = await recipient.request.post("/api/auth/organization/accept-invitation", { data: { invitationId } });
    expect(replay.ok()).toBeFalsy();
    await page.reload();
    await expect(row).toContainText("accepted");
    await expect(row.getByRole("button", { name: "Cancel invitation" })).toHaveCount(0);
    await expect(members).toContainText("Invitation recipient");
    const path = testInfo.outputPath("accepted.png");
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach("accepted", { path, contentType: "image/png" });
  } finally {
    await context.close();
  }
  await page.getByLabel("Invite email").fill(outsiderEmail);
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  const cancelRow = invitations.getByRole("row").filter({ hasText: outsiderEmail });
  await expect(cancelRow).toContainText("pending");
  const canceledHref = await cancelRow.getByRole("link", { name: "Invitation link" }).getAttribute("href");
  await cancelRow.getByRole("button", { name: "Cancel invitation" }).click();
  await expect(cancelRow).toContainText("canceled");
  await signIn(page.request, outsiderEmail);
  await page.goto(canceledHref!);
  await expect(page.getByRole("alert").filter({ hasText: "expired or is no longer pending" })).toBeVisible();
  const canceledAcceptance = await page.request.post("/api/auth/organization/accept-invitation", {
    data: { invitationId: canceledHref!.split("/").pop() },
  });
  expect(canceledAcceptance.ok()).toBeFalsy();
  await signIn(page.request, ownerEmail);
  await page.goto(`/dashboard/organizations/${slug}-other`);
  await expect(page.getByRole("table", { name: "Invitations", exact: true })).toContainText("No invitations yet.");
  await expect(page.getByRole("table", { name: "Members", exact: true })).not.toContainText("Example member");
});

test("members cannot manage invitations, outsiders cannot view organizations, errors are visible", async ({ page }) => {
  await signIn(page.request, memberEmail);
  await page.goto("/dashboard");
  const organizations = page.getByRole("table", { name: "Organizations", exact: true });
  await expect(organizations.getByRole("row").filter({ hasText: "Example workspace" }).getByRole("cell").last()).toHaveText("-");
  await page.goto(`/dashboard/organizations/${slug}`);
  await expect(page.getByRole("table", { name: "Members", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Invitations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
  const denied = await page.request.post("/api/auth/organization/invite-member", {
    data: { organizationId, email: outsiderEmail, role: "member" },
  });
  expect(denied.ok()).toBeFalsy();
  await signIn(page.request, outsiderEmail);
  await page.goto("/dashboard");
  await expect(organizations.getByRole("status")).toContainText("You are not in any organizations yet.");
  await expect(page.getByRole("textbox", { name: "Organization name" })).toBeVisible();
  await page.goto(`/dashboard/organizations/${slug}`);
  await expect(page.getByRole("heading", { name: "Example workspace" })).toHaveCount(0);
  await signIn(page.request, ownerEmail);
  await page.goto(`/dashboard/organizations/${slug}`);
  await page.getByLabel("Invite email").fill(memberEmail);
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /already a member/i })).toBeVisible();
  await page.route("**/api/auth/organization/invite-member", (route) => route.abort());
  await page.getByLabel("Invite email").fill(outsiderEmail);
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /.+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create invitation", exact: true })).toBeEnabled();
});

test("expired invitations cannot be accepted", async ({ page }) => {
  await signIn(page.request, ownerEmail);
  const invite = await page.request.post("/api/auth/organization/invite-member", {
    data: { organizationId: otherId, email: outsiderEmail, role: "member" },
  });
  expect(invite.ok(), await invite.text()).toBeTruthy();
  const invitationId = (await invite.json()).id;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('UPDATE "invitation" SET "expiresAt" = $1 WHERE "id" = $2 AND "organizationId" = $3', [
      new Date(Date.now() - 60_000), invitationId, otherId,
    ]);
  } finally {
    await pool.end();
  }
  await signIn(page.request, outsiderEmail);
  await page.goto(`/invitations/${invitationId}`);
  await expect(page.getByRole("alert").filter({ hasText: "expired or is no longer pending" })).toBeVisible();
  const response = await page.request.post("/api/auth/organization/accept-invitation", { data: { invitationId } });
  expect(response.ok()).toBeFalsy();
});
