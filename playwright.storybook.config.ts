import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/storybook",
  outputDir: "test-results/storybook",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/storybook-results.json" }],
  ],
  use: {
    baseURL: "http://localhost:6006",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run storybook -- --ci",
    url: "http://localhost:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
