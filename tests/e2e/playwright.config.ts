import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 300_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.ANVIL_E2E_BASE_URL,
    colorScheme: "dark",
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
