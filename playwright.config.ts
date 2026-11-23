import { defineConfig, devices } from "@playwright/test";

/** Port the backend API listens on during browser e2e runs. */
const API_PORT = 3000;

/** Fixed dev-server port for the web SPA, avoiding Vite's default 5173. */
const WEB_PORT = 4173;

/** Origin the browser uses to reach the web SPA. */
const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

/** Liveness URL used to wait for the backend webServer to become ready. */
const API_HEALTH_URL = `http://127.0.0.1:${API_PORT}/health`;

/**
 * Playwright configuration for the browser end-to-end suites. The `web` project
 * drives the real SPA in Chromium; the backend is started from its prior build
 * and the SPA from its dev server, both as managed webServers.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: WEB_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "web",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "web/**/*.spec.ts",
    },
  ],
  webServer: [
    {
      command: "npm run start -w apps/backend",
      url: API_HEALTH_URL,
      env: { ...process.env, PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -w apps/web -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
