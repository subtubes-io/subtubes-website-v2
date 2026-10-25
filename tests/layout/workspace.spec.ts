import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

const email = `layout-${randomUUID()}@example.test`;
const password = randomUUID();

async function expectFluidLayout(page: Page, width: number) {
  await expect(page.locator(".dashboard-wrap")).toHaveCSS("padding-top", width <= 520 ? "20px" : "24px");
  await expect(page.locator(".dashboard-header")).toHaveCSS("padding-bottom", "0px");
  await expect(page.locator(".dashboard-header")).toHaveCSS("border-bottom-width", "0px");
  await expect(page.locator(".dashboard-header p")).toHaveCount(0);
  expect((await page.locator(".dashboard-header").boundingBox())!.height).toBeLessThan(85);
  await expect(page.locator(".dashboard-heading")).toHaveCSS("font-size", width <= 520 ? "22px" : "24px");
  const layout = await page.locator(".dashboard-wrap").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      width: rect.width,
      left: Number.parseFloat(style.paddingLeft),
      right: Number.parseFloat(style.paddingRight),
    };
  });
  // The pages have the menu drawer beside the page (over it on a phone), so the page starts where the drawer ends.
  const drawer = page.getByRole("complementary", { name: "Dashboard" });
  const offset = width > 720 && (await drawer.count()) > 0 && (await drawer.isVisible()) ? (await drawer.boundingBox())!.width : 0;
  expect(layout.x).toBe(offset);
  expect(layout.width).toBe(width - offset);
  const gutter = width <= 520 ? 18 : Math.min(56, Math.max(20, width * 0.04));
  expect(layout.left).toBeCloseTo(gutter);
  expect(layout.right).toBeCloseTo(gutter);
  const brand = await page.getByRole("link", { name: "Subtubes home" }).boundingBox();
  const heading = await page.locator(".dashboard-heading").boundingBox();
  expect(brand).not.toBeNull();
  expect(heading).not.toBeNull();
  if (offset === 0) expect(heading!.x).toBeCloseTo(brand!.x);
}

test.beforeAll(async ({ request }) => {
  const signup = await request.post("/api/auth/sign-up/email", {
    data: { name: "Layout review", email, password },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
});

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('DELETE FROM "user" WHERE "email" = $1', [email]);
  } finally {
    await pool.end();
  }
});

for (const width of [390, 1440, 1920]) {
  test(`dashboard at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const signin = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password },
    });
    expect(signin.ok(), await signin.text()).toBeTruthy();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    const header = page.getByRole("banner").first();
    await expect(header.getByRole("button", { name: "Account menu for Layout review" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
    await expect(page.locator(".dashboard-header").getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await expectFluidLayout(page, width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    const path = testInfo.outputPath("workspace.png");
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach("workspace", { path, contentType: "image/png" });
  });
}

for (const width of [390, 1440]) {
  test(`light and dark themes persist at ${width}px`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    const response = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
    expect(response.ok(), await response.text()).toBeTruthy();
    await page.goto("/dashboard");
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", "dark");
    const toggle = page.getByRole("switch", { name: "Dark mode", exact: true });
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveCSS("height", "28px");
    await expect(toggle).toHaveCSS("width", "84px");
    await expect(toggle.locator("svg.lucide-sun")).toHaveCSS("width", "18px");
    await expect(toggle.locator("svg.lucide-moon")).toHaveCSS("width", "18px");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(root).toHaveCSS("color-scheme", "light");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(248, 250, 252)");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(toggle).not.toBeChecked();
    const secondTab = await context.newPage();
    try {
      await secondTab.goto("/dashboard");
      await expect(secondTab.locator("html")).toHaveAttribute("data-theme", "light");
      await toggle.click();
      await expect(secondTab.locator("html")).toHaveAttribute("data-theme", "dark");
      await toggle.click();
    } finally {
      await secondTab.close();
    }
    for (const [route, name] of [
      ["/dashboard", "Dashboard"],
      ["/dashboard/account", "Account"],
      ["/dashboard/profile", "Profile"],
      ["/sign-in", "Sign in to Subtubes"],
      ["/", "home"],
    ]) {
      if (route === "/sign-in") {
        const signout = await page.request.post("/api/auth/sign-out", { data: {} });
        expect(signout.ok(), await signout.text()).toBeTruthy();
      }
      await page.goto(route);
      if (route !== "/") await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      else await expect(page.locator(".hero-title")).toBeVisible();
      await expect(root).toHaveAttribute("data-theme", "light");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.evaluate(() => document.fonts.ready);
      const state = route === "/" ? "home" : route.split("/").pop()!;
      const path = testInfo.outputPath(`${state}-light.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await testInfo.attach(`${state}-light`, { path, contentType: "image/png" });
    }
    await toggle.click();
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    expect(errors).toEqual([]);
  });
}

test("theme switching reports blocked persistence and works when signed out", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("Storage disabled for test"); };
  });
  await page.goto("/sign-in");
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});

test("API at 1440px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/api-page");
  await expect(page.locator(".api-pre")).toContainText('"status": "ok"');
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "API endpoint response" })).toBeVisible();
  await expect(page.locator(".dashboard-wrap")).toHaveCSS("padding-top", "24px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath("api.png");
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    mask: [page.locator(".api-pre")],
  });
  await testInfo.attach("api", { path, contentType: "image/png" });
});

for (const width of [390, 1440]) {
  test(`sign-in at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in to Subtubes" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email or username" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
    const card = await page.locator(".auth-card").boundingBox();
    expect(card).not.toBeNull();
    expect(card!.width).toBeLessThanOrEqual(430);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath("sign-in.png");
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach("sign-in", { path, contentType: "image/png" });
  });
}

for (const width of [390, 1440]) {
  test(`account navigation and sign-out at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/sign-in");
    await page.getByRole("textbox", { name: "Email or username" }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    const header = page.getByRole("banner").first();
    const avatar = header.getByRole("button", { name: "Account menu for Layout review" });
    await expect(avatar).toBeVisible();
    await expect(header.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
    await avatar.click();
    await expect(header.getByRole("link", { name: "Account", exact: true })).toBeVisible();
    await expect(avatar).toHaveCSS("border-radius", "50%");
    await expect(header.locator(".account-panel")).toHaveCSS("position", "absolute");
    const panel = await header.locator(".account-panel").boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
    await page.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath("account-menu.png");
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach("account-menu", { path, contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(avatar).toBeFocused();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    await avatar.click();
    await page.getByRole("heading", { name: "Dashboard", exact: true }).click();
    await expect(avatar).toHaveAttribute("aria-expanded", "false");
    for (const destination of ["Account", "Profile", "Organizations"]) {
      await avatar.click();
      await header.getByRole("link", { name: destination, exact: true }).click();
      await expect(page.getByRole("heading", {
        name: destination === "Organizations" ? "Dashboard" : destination,
        exact: true,
      })).toBeVisible();
      await expect(avatar).toBeVisible();
    }
    await page.route("**/api/auth/sign-out", (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Test sign-out failure", code: "TEST_FAILURE" }),
    }));
    await avatar.click();
    await header.locator(".account-panel").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(header.getByRole("alert")).toContainText("Test sign-out failure");
    await expect(avatar).toBeVisible();
    await page.unroute("**/api/auth/sign-out");
    if (await avatar.getAttribute("aria-expanded") === "false") await avatar.click();
    await header.locator(".account-panel").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("http://localhost:3000/");
    await expect(page.getByRole("link", { name: "Get started", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu for Layout review" })).toHaveCount(0);
    await page.goto("/dashboard/account");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.goto("/dashboard/profile");
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  });
}


for (const width of [390, 1440]) {
  test(`dashboard menu at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const signin = await page.request.post("/api/auth/sign-in/email", { data: { email, password } });
    expect(signin.ok(), await signin.text()).toBeTruthy();
    await page.goto("/dashboard");

    const drawer = page.getByRole("complementary", { name: "Dashboard" });
    const toggle = page.getByRole("button", { name: /^(Close|Open) the menu$/ });
    // A phone starts with the menu closed; a larger screen starts with it open.
    if (width <= 720) {
      await expect(drawer).toBeHidden();
      await toggle.click();
    }
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await drawer.getByRole("link", { name: "Account" }).click();
    await expect(page).toHaveURL("/dashboard/account");
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page");
    await expect(drawer.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");

    // Closing it collapses it to the left, and the choice is remembered on the next visit.
    await page.getByRole("button", { name: "Close the menu" }).click();
    await expect(drawer).toBeHidden();
    await page.reload();
    await expect(drawer).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
