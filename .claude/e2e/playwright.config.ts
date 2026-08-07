import { defineConfig, devices } from "@playwright/test";

// The rig runs inside Compose and reaches the app over the service network, so
// it behaves identically here and in CI and does not depend on WD_PORT.
const baseURL = process.env.WD_BASE_URL ?? "http://app:8080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    // Firefox first: it is the primary target.
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
