import { expect, test } from "@playwright/test";

for (const state of ["populated", "empty", "loading", "error", "long-content"]) {
  for (const width of [390, 1440]) {
    test(`table ${state} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/iframe.html?id=ui-table--${state}&viewMode=story`);
      const table = page.getByRole("table", { name: "Organizations", exact: true });
      await expect(table).toBeVisible();
      await expect(table.getByRole("columnheader")).toHaveCount(4);
      if (state === "populated") {
        await expect(table.getByRole("row")).toHaveCount(4);
        await expect(table.getByRole("link", { name: "Example workspace" }))
          .toHaveAttribute("href", "/dashboard/organizations/example");
      } else if (state === "loading") {
        await expect(table).toHaveAttribute("aria-busy", "true");
        await expect(table.getByRole("status")).toHaveText("Loading records...");
      } else if (state === "error") {
        await expect(table.getByRole("alert")).toContainText("Could not load organizations");
      } else if (state === "empty") {
        await expect(table.getByRole("status")).toContainText("No organizations yet");
      } else {
        await expect(table.getByRole("link")).toContainText("international product");
      }
      const scroll = page.getByRole("region", { name: "Organizations table" });
      await scroll.focus();
      await expect(scroll).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 390) {
        expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await scroll.evaluate((element) => { element.scrollLeft = 0; });
      }
      await page.evaluate(() => document.fonts.ready);
      const path = testInfo.outputPath("table.png");
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await testInfo.attach("table", { path, contentType: "image/png" });
    });
  }
}

for (const state of ["signed-in", "loading", "signing-out", "sign-out-error", "session-error"]) {
  test(`header ${state}`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=layout-siteheader--${state}&viewMode=story`);
    const header = page.getByRole("banner");
    await expect(header).toBeVisible();
    await expect(header.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Get started" })).toHaveCount(0);
    if (state === "loading") {
      await expect(header.getByRole("status")).toHaveText("Loading account...");
    } else if (state === "session-error") {
      await expect(header.getByRole("alert")).toContainText("Could not load your session");
      await expect(header.getByRole("button", { name: "Retry" })).toBeEnabled();
    } else {
      const avatar = header.getByRole("button", { name: "Account menu for Alex Morgan" });
      await expect(avatar).toHaveAttribute("aria-expanded", "false");
      await avatar.click();
      await expect(avatar).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Tab");
      await expect(header.getByRole("link", { name: "Account", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(avatar).toBeFocused();
      await expect(avatar).toHaveAttribute("aria-expanded", "false");
      await avatar.click();
      await expect(header.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("href", "/dashboard/profile");
      await expect(header.getByRole("link", { name: "Organizations", exact: true })).toHaveAttribute("href", "/dashboard");
      if (state === "signing-out") {
        for (const button of await header.getByRole("button", { name: "Signing out..." }).all()) {
          await expect(button).toBeDisabled();
        }
      }
      if (state === "sign-out-error") await expect(header.getByRole("alert")).toContainText("Could not sign out");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const panel = header.locator(".account-panel");
    if (await panel.count()) {
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    await page.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath("header.png");
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach("header", { path, contentType: "image/png" });
  });
}
