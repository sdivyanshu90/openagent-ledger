import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:43127",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:43127/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_FILE: ".data/e2e.json",
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      PORT: "43127",
    },
  },
});
