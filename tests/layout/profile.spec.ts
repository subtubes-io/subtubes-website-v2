import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import sharp from "sharp";

const email = `avatar-${randomUUID()}@example.test`;
const password = randomUUID();

test.beforeAll(async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { name: "Avatar review", email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('DELETE FROM "user" WHERE "email" = $1', [email]);
  } finally {
    await pool.end();
  }
});

test("profile appearance", async ({ page }, testInfo) => {
  const response = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/dashboard/profile");
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu for Avatar review" })).toBeVisible();
  await expect(page.locator(".dashboard-wrap")).toHaveCSS("padding-top", "24px");
  expect((await page.locator(".dashboard-header").boundingBox())!.height).toBeLessThan(40);
  await expect(page.locator(".dashboard-header p")).toHaveCount(0);
  await expect(page.locator(".dashboard-header")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".profile-avatar-section")).toHaveCSS("display", "flex");
  await expect(page.locator(".profile-avatar-preview")).toHaveCSS("border-radius", "50%");
  await expect(page.locator(".profile-card")).toHaveCSS("max-width", "460px");
  await expect(page.locator(".profile-avatar-section").getByRole("heading", { name: "Avatar review", exact: true })).toBeVisible();
  await expect(page.locator(".profile-avatar-username")).toHaveText("Username not set");
  await expect(page.getByRole("heading", { name: "Profile photo", exact: true })).toHaveCount(0);
  await expect(page.locator(".profile-card .settings-details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change profile photo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload avatar", exact: true })).toHaveCount(0);
  await expect(page.getByText("Click your photo to change it. Saves automatically.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".profile-avatar-instructions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change profile photo" })).not.toHaveAttribute("aria-describedby", "avatar-instructions");
  await expect(page.locator(".profile-links-form")).toHaveCSS("display", "flex");
  await expect(page.locator(".profile-link-icon")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Save links" })).toHaveCSS("height", "28px");
  await expect(page.getByRole("button", { name: "Save links" })).toHaveCSS("width", `${await page.locator(".profile-links-form").evaluate((element) => element.clientWidth)}px`);
  await expect(page.locator(".profile-link-field label").first()).toHaveClass("sr-only");
  const card = await page.locator(".profile-card").boundingBox();
  expect(card!.width).toBeLessThanOrEqual(460);
  expect(card!.height).toBeLessThan(500);
  const icon = await page.locator(".profile-link-icon").first().boundingBox();
  const input = await page.getByRole("textbox", { name: "X", exact: true }).boundingBox();
  expect(icon!.x + icon!.width).toBeLessThan(input!.x);
  expect(Math.abs(icon!.y + icon!.height / 2 - input!.y - input!.height / 2)).toBeLessThan(1);
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath("profile.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("profile", { path, contentType: "image/png" });
  await page.getByRole("textbox", { name: "X", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("border-top-width", "1px");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("box-shadow", "none");
  await expect.poll(() => page.getByRole("textbox", { name: "X", exact: true }).evaluate((element) => getComputedStyle(element).borderColor))
    .not.toBe(await page.getByRole("textbox", { name: "LinkedIn", exact: true }).evaluate((element) => getComputedStyle(element).borderColor));
  const focusedPath = testInfo.outputPath("profile-input-focused.png");
  await page.screenshot({ path: focusedPath, fullPage: true, animations: "disabled" });
  await testInfo.attach("profile-input-focused", { path: focusedPath, contentType: "image/png" });
});

test("profile identity shows the real name and username beside the avatar", async ({ page }) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  const username = `review_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const response = await page.request.post("/api/auth/update-user", { data: { username } });
  expect(response.ok(), await response.text()).toBeTruthy();
  try {
    await page.goto("/dashboard/profile");
    const identity = page.locator(".profile-avatar-section");
    await expect(identity.getByRole("heading", { name: "Avatar review", exact: true })).toBeVisible();
    await expect(identity.locator(".profile-avatar-username")).toHaveText(`@${username}`);
    await expect(page.locator(".profile-card .settings-details")).toHaveCount(0);
  } finally {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('UPDATE "user" SET "username" = NULL WHERE "email" = $1', [email]);
    } finally {
      await pool.end();
    }
  }
});

test("account heading appearance", async ({ page }, testInfo) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  await page.goto("/dashboard/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu for Avatar review" })).toBeVisible();
  await expect(page.locator(".dashboard-heading")).toHaveCSS("font-size", "24px");
  expect((await page.locator(".dashboard-header").boundingBox())!.height).toBeLessThan(40);
  await expect(page.locator(".dashboard-header p")).toHaveCount(0);
  await expect(page.locator(".dashboard-header")).toHaveCSS("border-bottom-width", "0px");
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath("account.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("account", { path, contentType: "image/png" });
});

test("avatar updates profile and header with a simulated storage response", async ({ page }, testInfo) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#38bdf8" } }).png().toBuffer();
  const image = `data:image/png;base64,${bytes.toString("base64")}`;
  await page.route("**/api/profile/avatar", async (route) => {
    const update = await page.request.post("/api/auth/update-user", { data: { image } });
    expect(update.ok(), await update.text()).toBeTruthy();
    await route.fulfill({ json: { image } });
  });
  await page.goto("/dashboard/profile");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Change profile photo" }).click();
  await (await chooser).setFiles({ name: "avatar.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByRole("status")).toContainText("Avatar updated.");
  await expect(page.getByRole("img", { name: "Avatar review's avatar" })).toHaveAttribute("src", image);
  await expect(page.locator(".account-avatar img")).toHaveAttribute("src", image);
  await expect(page.locator(".account-avatar")).toHaveCSS("overflow", "hidden");
  await page.reload();
  await expect(page.locator(".account-avatar img")).toHaveAttribute("src", image);
  const path = testInfo.outputPath("saved-avatar.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("saved-avatar", { path, contentType: "image/png" });
});

test("profile avatar fits mobile in dark mode", async ({ page }, testInfo) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/profile");
  await expect(page.getByRole("button", { name: "Account menu for Avatar review" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".profile-avatar-section")).toHaveCSS("flex-direction", "row");
  await expect(page.locator(".profile-card")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save links" })).toHaveCSS("height", "28px");
  await expect(page.getByRole("button", { name: "Save links" })).toHaveCSS("width", `${await page.locator(".profile-links-form").evaluate((element) => element.clientWidth)}px`);
  await expect.poll(async () => (await page.locator(".profile-card").boundingBox())?.height ?? Infinity).toBeLessThan(540);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const path = testInfo.outputPath("profile-mobile-dark.png");
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach("profile-mobile-dark", { path, contentType: "image/png" });
  await page.getByRole("textbox", { name: "X", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("border-top-width", "1px");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveCSS("box-shadow", "none");
  await expect.poll(() => page.getByRole("textbox", { name: "X", exact: true }).evaluate((element) => getComputedStyle(element).borderColor))
    .not.toBe(await page.getByRole("textbox", { name: "LinkedIn", exact: true }).evaluate((element) => getComputedStyle(element).borderColor));
  const focusedPath = testInfo.outputPath("profile-input-focused-dark.png");
  await page.screenshot({ path: focusedPath, fullPage: true, animations: "disabled" });
  await testInfo.attach("profile-input-focused-dark", { path: focusedPath, contentType: "image/png" });
});

test("avatar errors are visible and do not change the profile", async ({ page }) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  await page.goto("/dashboard/profile");
  await expect(page.getByRole("button", { name: "Account menu for Avatar review" })).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Change profile photo" }).click();
  await (await chooser).setFiles({ name: "image.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByText("Choose a PNG, JPEG, or WebP image up to 2 MB.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change profile photo" })).toBeEnabled();
  await page.route("**/api/profile/avatar", (route) => route.fulfill({ status: 503, json: { error: "Avatar storage is not configured." } }));
  await page.getByLabel("Choose avatar image").setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("invalid") });
  await expect(page.getByText("Avatar storage is not configured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change profile photo" })).toBeEnabled();
});

test("avatar API rejects unauthorized, cross-origin, corrupt and oversized uploads", async ({ request }) => {
  await request.post("/api/auth/sign-out", { data: {} });
  const anonymous = await request.post("/api/profile/avatar", { multipart: { avatar: { name: "image.png", mimeType: "image/png", buffer: Buffer.from("invalid") } } });
  expect(anonymous.status()).toBe(401);
  await request.post("/api/auth/sign-in/email", { data: { email, password } });
  const crossOrigin = await request.post("/api/profile/avatar", { headers: { Origin: "https://example.test" }, multipart: { avatar: { name: "image.png", mimeType: "image/png", buffer: Buffer.from("invalid") } } });
  expect(crossOrigin.status()).toBe(403);
  const invalid = await request.post("/api/profile/avatar", { multipart: { avatar: { name: "image.png", mimeType: "image/png", buffer: Buffer.from("invalid") } } });
  expect(invalid.status()).toBe(400);
  const large = await request.post("/api/profile/avatar", { multipart: { avatar: { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 20_000) } } });
  expect(large.status()).toBe(413);
});

test("avatar picker disables during upload and permits retrying the same file", async ({ page }) => {
  await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
  let release: (() => void) | undefined;
  let count = 0;
  await page.route("**/api/profile/avatar", async (route) => {
    count++;
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 503, json: { error: "Upload unavailable. Try again." } });
  });
  await page.goto("/dashboard/profile");
  const picker = page.getByLabel("Choose avatar image");
  const button = page.getByRole("button", { name: "Change profile photo" });
  const file = { name: "retry.png", mimeType: "image/png", buffer: Buffer.from("simulated upload") };
  for (let attempt = 1; attempt <= 2; attempt++) {
    await picker.setInputFiles(file);
    await expect(button).toBeDisabled();
    await expect(page.locator(".profile-avatar-section").getByRole("status")).toHaveText("Uploading photo...");
    await expect.poll(() => count).toBe(attempt);
    release?.();
    await expect(button).toBeEnabled();
    await expect(page.getByText("Upload unavailable. Try again.", { exact: true })).toBeVisible();
    await expect(picker).toHaveValue("");
  }
});

  test("social links save, reload, open safely, and can be removed", async ({ page }, testInfo) => {
    await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
    await page.goto("/dashboard/profile");
    const fields = {
      X: "https://x.com/avatarreview",
      LinkedIn: "https://www.linkedin.com/in/avatarreview",
      GitHub: "https://github.com/avatarreview",
      "Hugging Face": "https://huggingface.co/avatarreview",
    };
    for (const [label, url] of Object.entries(fields)) await page.getByRole("textbox", { name: label, exact: true }).fill(url);
    await page.getByRole("button", { name: "Save links" }).click();
    await expect(page.getByText("Profile links saved.", { exact: true })).toBeVisible();
    await page.reload();
    for (const [label, url] of Object.entries(fields)) {
      await expect(page.getByRole("textbox", { name: label, exact: true })).toHaveValue(url);
      await expect(page.getByRole("link", { name: `Open ${label} profile` })).toHaveAttribute("href", url);
      await expect(page.getByRole("link", { name: `Open ${label} profile` })).toHaveAttribute("rel", "noopener noreferrer");
    }
    const path = testInfo.outputPath("saved-links.png");
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach("saved-links", { path, contentType: "image/png" });
    await page.getByRole("textbox", { name: "X", exact: true }).fill("");
    await page.getByRole("button", { name: "Save links" }).click();
    await expect(page.getByText("Profile links saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "X", exact: true })).toHaveValue("");
    await expect(page.getByRole("link", { name: "Open X profile" })).toHaveCount(0);
  });

  test("social links reject invalid destinations and surface save errors", async ({ page }) => {
    await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
    await page.goto("/dashboard/profile");
    await page.getByRole("textbox", { name: "GitHub", exact: true }).fill("https://evil.test/example");
    await page.getByRole("button", { name: "Save links" }).click();
    await expect(page.getByText("Use an HTTPS profile URL on github.com.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "GitHub", exact: true }).fill("https://github.com/example");
    await page.route("**/api/profile/links", (route) => route.fulfill({ status: 500, json: { error: "Could not save your profile links. Please try again." } }));
    await page.getByRole("button", { name: "Save links" }).click();
    await expect(page.getByText("Could not save your profile links. Please try again.", { exact: true })).toBeVisible();
  });

  test("social links API checks authentication, origin, validation and account isolation", async ({ request, playwright }) => {
    await request.post("/api/auth/sign-out", { data: {} });
    const links = { x: null, linkedin: null, github: "https://github.com/avatarreview", huggingface: null };
    expect((await request.put("/api/profile/links", { data: links })).status()).toBe(401);
    await request.post("/api/auth/sign-in/email", { data: { email, password } });
    expect((await request.put("/api/profile/links", { data: links, headers: { Origin: "https://evil.test" } })).status()).toBe(403);
    expect((await request.put("/api/profile/links", { data: { ...links, github: "javascript:alert(1)" } })).status()).toBe(400);
    const otherEmail = `links-isolation-${randomUUID()}@example.test`;
    const other = await playwright.request.newContext({ baseURL: "http://localhost:3000", extraHTTPHeaders: { Origin: "http://localhost:3000" } });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      expect((await other.post("/api/auth/sign-up/email", { data: { name: "Other profile", email: otherEmail, password } })).ok()).toBeTruthy();
      const result = await other.put("/api/profile/links", { data: { ...links, github: "https://github.com/otherprofile", userId: "not-the-caller" } });
      expect(result.ok(), await result.text()).toBeTruthy();
      const { rows } = await pool.query('SELECT p.github FROM "profileLinks" p JOIN "user" u ON u.id = p."userId" WHERE u.email = $1', [otherEmail]);
      expect(rows[0].github).toBe("https://github.com/otherprofile");
      const original = await pool.query('SELECT p.github FROM "profileLinks" p JOIN "user" u ON u.id = p."userId" WHERE u.email = $1', [email]);
      expect(original.rows[0].github).not.toBe("https://github.com/otherprofile");
    } finally {
      await pool.query('DELETE FROM "user" WHERE email = $1', [otherEmail]);
      await pool.end();
      await other.dispose();
    }
  });
