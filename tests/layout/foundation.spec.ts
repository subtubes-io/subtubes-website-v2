import { expect, test } from "@playwright/test";

test("public foundation landing page", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your account.Your dashboard.");
  await expect(page.locator("main")).not.toContainText(/reports|diagrams|designs|publish|sync/i);
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath("landing.png");
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach("landing", { path, contentType: "image/png" });
});

test("retired content endpoints are unavailable", async ({ request }) => {
  for (const path of [
    "/api/v1/organizations/example/reports",
    "/api/v1/organizations/example/reports/example",
    "/api/v1/organizations/example/reports/example/clone",
    "/api/v1/organizations/example/designs",
    "/api/v1/organizations/example/designs/example",
    "/api/v1/organizations/example/designs/example/clone",
    "/api/v1/organizations/example/blobs/missing",
    "/api/v1/organizations/example/blobs/uploads",
    "/api/v1/organizations/example/blobs/uploads/example/complete",
    "/api/v1/organizations/example/blobs/example",
    "/api/v1/organizations/example/limits",
    "/api/organizations/example/reports/example/clone",
    "/api/blobs/example",
    "/dashboard/organizations/example/reports/example",
  ]) {
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await request.fetch(path, { method });
      expect(response.status(), `${method} ${path}`).toBe(404);
    }
  }
});
