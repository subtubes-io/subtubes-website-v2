import { loadEnvConfig } from "@next/env";
import { defineConfig } from "@playwright/test";

loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/layout",
  workers: 1,
  outputDir: "test-results/layout",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/layout-results.json" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: { Origin: "http://localhost:3000" },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
