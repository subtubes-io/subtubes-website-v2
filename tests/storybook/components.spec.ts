import { expect, test } from "@playwright/test";

const stories = [
  "ui-button--primary",
  "ui-button--secondary",
  "ui-button--disabled",
  "ui-button--pending",
  "ui-button--full-width",
  "ui-button--compact",
  "ui-button--compact-secondary",
  "ui-button--compact-disabled",
  "ui-button--compact-pending",
  "ui-button--compact-full-width",
  "ui-input--default",
  "ui-input--disabled",
  "ui-input--invalid",
  "ui-input--password",
  "ui-input--device-code",
  "ui-formerror--default",
  "ui-formerror--long-message",
  "layout-siteheader--default",
];

for (const id of stories) {
  test(id, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);
    const root = page.locator("#storybook-root");
    await expect(root).not.toBeEmpty();
    if (id.startsWith("ui-button")) {
      const button = root.getByRole("button");
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("type", "button");
      await expect(button).toHaveCSS("height", id.includes("--compact") ? "28px" : "42px");
      if (id.endsWith("full-width")) await expect(button).toHaveCSS("width", `${await root.evaluate((element) => element.clientWidth)}px`);
      if (id.endsWith("disabled") || id.endsWith("pending")) {
        await expect(button).toBeDisabled();
      } else {
        await expect(button).toBeEnabled();
        await button.click();
      }
    } else if (id.startsWith("ui-input")) {
      const input = root.getByLabel("Example input");
      await expect(input).toBeVisible();
      if (id.endsWith("disabled")) {
        await expect(input).toBeDisabled();
      } else {
        if (id === "ui-input--default") {
          await expect(input).toHaveValue("designer@example.test");
        }
        await input.fill("test@example.test");
        await expect(input).toHaveValue("test@example.test");
      }
      if (id.endsWith("invalid")) await expect(input).toHaveAttribute("aria-invalid", "true");
      if (id.endsWith("password")) await expect(input).toHaveAttribute("type", "password");
    } else if (id.startsWith("ui-formerror")) {
      await expect(root.getByRole("alert")).toContainText("try again");
    } else {
      await expect(root.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
      await expect(root.getByRole("link", { name: "Subtubes home" })).toHaveAttribute("href", "/");
      await expect(root.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/sign-up");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(root.getByRole("link", { name: "Get started" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    await page.evaluate(() => document.fonts.ready);
    const screenshotPath = testInfo.outputPath("component.png");
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      animations: "disabled",
    });
    await testInfo.attach("component", {
      path: screenshotPath,
      contentType: "image/png",
    });
    expect(errors).toEqual([]);
  });
}
