// Local smoke test (SPEC-platform: one Playwright e2e against netlify dev). Not run in CI: it needs the secrets in .env.
// Uses the system Chromium (CHROMIUM_PATH to override) instead of downloading Playwright's browsers. The specs run as the
// owner: LIVE_ACCESS_KEY from .env on every request (e2e/live.ts puts the app in live mode).
import { defineConfig } from "@playwright/test";

try { process.loadEnvFile(); } catch { /* no .env: e2e/live.ts says what is missing */ }

export default defineConfig({
  testDir: "e2e",
  testIgnore: "snapshot.spec.ts", // the public site: playwright.snapshot.config.ts
  timeout: 120_000,
  workers: 1, // one shared dev server and database: run the flows one after another
  reporter: "list",
  use: {
    baseURL: "http://localhost:8888",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" },
    trace: "retain-on-failure",
    extraHTTPHeaders: process.env.LIVE_ACCESS_KEY ? { authorization: `Bearer ${process.env.LIVE_ACCESS_KEY}` } : {},
  },
  webServer: {
    command: "mise exec node@22 -- netlify dev --offline",
    url: "http://localhost:8888",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
