// The public site as visitors get it (SPEC-public-release W2): the static build served with no functions, reading the
// committed snapshot. Needs no secrets. Uses the system Chromium (CHROMIUM_PATH to override), like playwright.config.ts.
// PUBLIC_SITE_URL runs the same spec against the deployed site instead of a local build.
import { defineConfig } from "@playwright/test";

const remote = process.env.PUBLIC_SITE_URL;

export default defineConfig({
  testDir: "e2e",
  testMatch: "snapshot.spec.ts",
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: remote ?? "http://localhost:4173",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" },
    trace: "retain-on-failure",
  },
  webServer: remote ? undefined : {
    command: "vite build && vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
