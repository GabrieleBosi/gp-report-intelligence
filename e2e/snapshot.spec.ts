// The public site (SPEC-public-release W2, criteria 2 and 3): the static build with no functions behind it. Every page
// renders from the snapshot, a visitor can correct a flagged figure and post the run in their browser, and nothing
// asks /api/ for anything.
import { expect, test, type Page } from "@playwright/test";
import { DEMO_RUNS, hrefFor, IMPROVEMENT_LOOP, LOOP_TIMELINE, PROCESS_STEPS, REQUIREMENTS, SKETCH_STEPS, TOURS } from "../src/showcase/content.ts";

let apiCalls: string[] = [];
test.beforeEach(({ page }) => {
  apiCalls = [];
  page.on("request", (r) => { const { pathname } = new URL(r.url()); if (pathname.startsWith("/api/")) apiCalls.push(pathname); });
});
test.afterEach(() => { expect(apiCalls, "requests to /api/ on the public site").toEqual([]); });

const loaded = async (page: Page, href: string) => {
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ }), href).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Page not found"), href).toHaveCount(0);
  await expect(page.getByRole("alert"), href).toHaveCount(0);
  await expect(page.locator("main").getByRole("heading").first(), href).toBeVisible();
};

test("every page, every tour step and every evidence link renders from the snapshot", async ({ page }) => {
  const evidence = [...SKETCH_STEPS.flatMap((s) => s.evidence), ...IMPROVEMENT_LOOP.evidence, ...REQUIREMENTS.flatMap((r) => r.evidence),
    ...LOOP_TIMELINE.flatMap((t) => t.evidence), ...PROCESS_STEPS.map((s) => s.example), ...TOURS.flatMap((t) => t.steps.map((s) => s.link))];
  const pages = ["/", "/review", "/portfolio", "/about", "/tour", "/evals", "/decisions", "/process",
    ...Object.values(DEMO_RUNS).map((r) => `/runs/${r.id}`), ...evidence.map(hrefFor)];
  for (const href of new Set(pages)) {
    await page.goto(href);
    await loaded(page, href);
    await expect(page.getByText(/^Recorded runs of the real pipeline/), href).toBeVisible();
  }
});

test("a visitor corrects a figure read only from a chart, approves, and the record joins the portfolio; a reload undoes it", async ({ page }) => {
  const file = "alpenrose-iv-2025q3-chart-nav.pdf";
  await page.goto("/review");
  await page.getByRole("link", { name: new RegExp(file.replaceAll(".", "\\.")) }).click();
  await expect(page.getByRole("img", { name: `Page 1 of ${file}` })).toBeVisible();
  await page.getByLabel("Your name").fill("A visitor");

  await page.getByRole("button", { name: "Correct Net asset value" }).click();
  await page.getByLabel("Value as printed").fill("431.1");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText(/corrected fund\.nav/)).toBeVisible();
  await page.getByRole("button", { name: "Approve for posting" }).click();
  await expect(page.getByText("posted", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Review queue" }).click(); // in-app navigation keeps this tab's decisions
  await expect(page.getByRole("link", { name: new RegExp(file.replaceAll(".", "\\.")) })).toHaveCount(0);
  await page.getByRole("link", { name: "Portfolio system", exact: true }).click();
  const posted = page.getByRole("row", { name: /Alpenrose Buyout IV.*Q3 2025/ });
  await expect(posted).toContainText("v1 · current");
  await expect(posted).toContainText("A visitor");

  await page.reload();
  await expect(page.getByRole("row", { name: /Alpenrose Buyout IV.*Q4 2025|Alpenrose Buyout IV.*Q1 2026/ }).first()).toBeVisible();
  await expect(posted).toHaveCount(0);
});

test("the showcase describes what the visitor is looking at: recorded runs, not a live app", async ({ page }) => {
  await page.goto("/tour");
  await expect(page.getByText(/The runs linked here are recorded runs of the real pipeline/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/live app|room for uploads/);

  await page.goto("/evals");
  const recorded = page.getByRole("region", { name: "Recorded on this site" });
  await expect(recorded.getByText(/^As of .* \(Zurich\) · counts only$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Live on this site" })).toHaveCount(0);

  await page.goto("/process");
  await expect(page.locator("main")).toContainText("Built with Claude Code");
  await expect(page.locator("main")).not.toContainText("AI coding agent");
  await expect(page.getByText(/development history, kept in a private archive/)).toBeVisible();

  await page.goto("/about");
  await page.getByRole("tab").nth(8).click(); // step 9, the analyst's review: its evidence includes runs
  await expect(page.getByRole("tabpanel").getByText("Recorded runs", { exact: true })).toBeVisible();
});

// SPEC-showcase criterion 6: usable on a 1280x720 projector and a phone, with the snapshot banner above the header.
// Screenshots for the acceptance report are written when SHOWCASE_SCREENSHOTS is set.
const SHOWCASE_PAGES = ["/about", "/tour", "/evals", "/decisions", "/process", "/docs/SPEC-evals.md"];
for (const [width, height] of [[1280, 720], [390, 844]] as const) {
  test(`every showcase page fits ${width}x${height}: no sideways scrolling, its heading on the first screen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of SHOWCASE_PAGES) {
      await page.goto(path);
      await loaded(page, path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(width);
      await expect(page.locator("main h2").first(), path).toBeInViewport();
      if (process.env.SHOWCASE_SCREENSHOTS) {
        await page.screenshot({ path: `docs/acceptance/showcase/${path.split("/")[1]}-${width}.png` });
      }
    }
  });
}

test("the page has an icon and a description, for the browser tab and link previews", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBeTruthy();
  const icon = await request.get(href ?? "");
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /PE fund reports|private equity fund reports/);
  // Link previews (LinkedIn, GitHub, chat apps) take the picture from og:image, an absolute URL on the public site.
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toBe("https://gp-report-intelligence.netlify.app/og-image.png");
  const local = await request.get(new URL(image ?? "").pathname);
  expect(local.headers()["content-type"]).toContain("image/png");
});

test("owner access refuses a key the live functions do not accept, and the site stays public", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Owner access" }).click();
  await page.getByLabel("Access key").fill("k".repeat(40));
  await page.getByRole("button", { name: "Use live mode" }).click();
  await expect(page.getByRole("alert")).toHaveText(process.env.PUBLIC_SITE_URL
    ? "This needs the owner's access key. The public site reads a recorded snapshot." // the deployed functions' 401
    : "Live mode is not available here: the health check answered with a page, not the API."); // a static build
  await page.reload();
  await expect(page.getByText(/^Recorded runs of the real pipeline/)).toBeVisible();
  apiCalls = apiCalls.filter((p) => p !== "/api/health"); // the one request owner access makes, on purpose
});
