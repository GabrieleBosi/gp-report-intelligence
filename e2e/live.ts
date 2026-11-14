// The live e2e specs run as the owner (SPEC-public-release W2): LIVE_ACCESS_KEY from .env goes on every request
// (playwright.config.ts), and the app starts in live mode, as after "Owner access".
import { test as base } from "@playwright/test";
import { STORAGE_KEY } from "../src/lib/access.ts";

export const test = base.extend({
  page: async ({ page }, provide) => { // Playwright's "use", renamed: the React hooks lint rule matches the name
    const key = process.env.LIVE_ACCESS_KEY;
    if (!key) throw new Error("LIVE_ACCESS_KEY is not set in .env: the live e2e specs need the owner's key.");
    await page.addInitScript(([name, value]) => { sessionStorage.setItem(name, value); }, [STORAGE_KEY, key] as const);
    await provide(page);
  },
});
export { expect } from "@playwright/test";
