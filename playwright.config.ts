import { defineConfig, devices } from "@playwright/test";

// Lab 2 E2E + responsive/visual suite (tests.md E2E-01, E2E-02, RESP-01).
// Requires the Postgres container to be running and the database migrated and
// seeded; Playwright starts the API and the client dev server itself.
//
// 127.0.0.1 is used instead of localhost throughout: an unrelated process on
// this machine binds [::1]:3001, so "localhost" can resolve to the wrong app.
const API_PORT = 3001;
const CLIENT_PORT = 5180;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

export default defineConfig({
  testDir: "./e2e/lab-02",
  // The specs share one seeded database and create real Tickets, so they run
  // serially rather than racing each other's list assertions.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: {
    baseURL: CLIENT_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      cwd: "./server",
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // --host 127.0.0.1 is required: Vite otherwise binds only the IPv6
      // localhost, which this config cannot use (see the note above).
      command: `npm run dev -- --port ${CLIENT_PORT} --strictPort --host 127.0.0.1`,
      cwd: "./client",
      url: CLIENT_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
