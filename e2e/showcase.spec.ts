// The showcase pages (SPEC-showcase), against netlify dev. Local only, like the other e2e tests.
import { expect, test } from "./live.ts";
import { DEMO_RUNS, hrefFor, IMPROVEMENT_LOOP, LOOP_TIMELINE, PROCESS_STEPS, REQUIREMENTS, SKETCH_STEPS, TOURS } from "../src/showcase/content.ts";

test("the overview rebuilds the sketch: every step opens its evidence, by mouse and by keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("heading", { name: "What this system does, and why it can be trusted" })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Steps of the process sketch" }).getByRole("tab");
  await expect(tabs).toHaveCount(SKETCH_STEPS.length + 1); // the 9 steps and the improvement loop
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { level: 3 })).toContainText("1. Receive and store the raw file");

  await tabs.nth(6).click();
  await expect(panel).toContainText("independent second read");
  await expect(panel.getByRole("link", { name: "SPEC-confidence.md › The confidence matrix (per key figure)" })).toBeVisible();

  await page.keyboard.press("ArrowRight"); // step 8
  await expect(tabs.nth(7)).toBeFocused();
  await expect(tabs.nth(7)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(panel.getByRole("heading", { level: 3 })).toContainText("Improvement loop");
  await page.keyboard.press("ArrowRight"); // wraps to step 1
  await expect(panel.getByRole("heading", { level: 3 })).toContainText("1. Receive");

  await tabs.nth(8).click();
  await panel.getByRole("link", { name: DEMO_RUNS.trap1Approved.label }).click();
  await expect(page).toHaveURL(`/runs/${DEMO_RUNS.trap1Approved.id}`);
  await expect(page.getByText("Posted", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
});

// Routes still to be built in this module (none left since H6).
const PENDING: RegExp[] = [];

test("the tour: three scenarios in 10 minutes, and every link opens a real page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Tour", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Demo tour" })).toBeVisible();
  await expect(page.getByText("About 10 minutes in total")).toBeVisible();

  const scenarios = page.getByRole("article");
  await expect(scenarios).toHaveCount(TOURS.length);
  for (const [i, tour] of TOURS.entries()) {
    await expect(scenarios.nth(i).getByRole("heading", { level: 3 })).toHaveText(`${String.fromCharCode(65 + i)}. ${tour.title}`);
    await expect(scenarios.nth(i).getByRole("listitem")).toHaveCount(tour.steps.length);
  }

  const hrefs = [...new Set(TOURS.flatMap((t) => t.steps.map((s) => hrefFor(s.link))))];
  for (const href of hrefs.filter((h) => !PENDING.some((p) => p.test(h)))) {
    await page.goto(href);
    await expect(page.getByText("Page not found"), href).toHaveCount(0);
    // wait until the page has loaded its data (every page shows "Loading …" until then), then: no error shown
    await expect(page.getByRole("status").filter({ hasText: /^Loading/ }), href).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator("main").getByRole("heading").first(), href).toBeVisible();
    await expect(page.getByRole("alert"), href).toHaveCount(0);
  }
});

test("the evals page: the gate, errors by step, held-out history, shadow and the loop, every number dated", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Evals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evals", level: 2 })).toBeVisible();

  const gate = page.getByRole("table", { name: /Gated metrics/ });
  await expect(gate.getByRole("row", { name: /Unsafe auto-posts/ })).toContainText("must be 0");
  await expect(page.getByText(/pipeline@0\.13\.0 · 12 dev documents · 2026-10-11/)).toBeVisible();
  await expect(page.getByText("3 · parse / OCR").first()).toBeVisible();
  await expect(page.getByText("5 of 6 routes as labelled")).toBeVisible(); // the Sonnet measurement, as stored
  await expect(page.getByText("1 unsafe")).toBeVisible();
  await expect(page.getByRole("table", { name: "Shadow experiments" }).getByRole("row")).toHaveCount(5);
  await expect(page.getByText("16:20 · Rollback")).toBeVisible();

  // live numbers from /api/metrics, counts only
  const live = page.getByRole("region", { name: "Live on this site" });
  await expect(live.getByText(/^As of .* \(Zurich\) · counts only$/)).toBeVisible();
  await expect(live.getByText(/synthetic corpus/)).toBeVisible();
  await expect(live.getByText(/routed: \d+ auto-post · \d+ review · \d+ triage/)).toBeVisible();
  const metrics = await (await page.request.get("/api/metrics")).json() as Record<string, unknown>;
  expect(Object.keys(metrics).sort()).toEqual(["documents", "generated_at", "llm", "portfolio", "postings", "review", "routes", "runs"]);
  expect(JSON.stringify(metrics)).not.toMatch(/\.pdf|\.xlsx|corpus_meta|analyst/);

  await page.getByRole("link", { name: DEMO_RUNS.restatementWrongV1.label }).click();
  await expect(page).toHaveURL(`/runs/${DEMO_RUNS.restatementWrongV1.id}`);
});

test("the decisions page: requirement → choice, and every decision from the specs with its date and section", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Decisions", level: 2 })).toBeVisible();
  await expect(page.getByText("The 44 decisions below are read from the specs themselves")).toBeVisible();
  await expect(page.getByRole("table", { name: "Business requirements and technical choices" }).getByRole("row")).toHaveCount(REQUIREMENTS.length + 1);

  const confidence = page.locator("#confidence");
  await expect(confidence.getByRole("listitem")).toHaveCount(7);
  await expect(confidence.getByRole("listitem").last()).toContainText("policy@3");
  await expect(confidence.getByRole("listitem").last()).toContainText("2026-10-11");
  await expect(confidence.getByRole("link", { name: "SPEC-confidence.md › Decisions (approved 2026-10-11)" }).first()).toBeVisible();

  // inline Markdown is rendered, and a link inside a decision stays in the app
  await expect(page.locator("#capability-map strong", { hasText: "about ten days" })).toBeVisible();
  await page.getByRole("link", { name: "Confidence (7)" }).click();
  await expect(page).toHaveURL(/\/decisions#confidence$/);

  // a link straight to a section (as the evidence links are) lands on it
  await page.goto("/about");
  await page.goto("/decisions#posting");
  await expect(page.locator("#posting")).toBeInViewport();
});

test("how it was built: the workflow, the build facts, and every document and test readable in the app", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How it was built", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How it was built", level: 2 })).toBeVisible();
  await expect(page.getByRole("list", { name: "The workflow" }).getByRole("listitem")).toHaveCount(6);
  await expect(page.getByText(/were the deliberate gate proof/)).toBeVisible();

  // a spec, from the index
  await page.getByRole("link", { name: "SPEC-evals.md", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Spec: evals", level: 2 })).toBeVisible();
  await expect(page.locator(".doc-prose table").first()).toBeVisible();

  // a test file, as code
  await page.goto("/process");
  await page.getByText(/Show all \d+ test files/).click();
  await page.getByRole("link", { name: "tests/core/confidence/assess.test.ts" }).click();
  await expect(page.locator("pre code")).toContainText("policy@3");

  // an evidence link to a section lands on the section, after the document has loaded
  await page.goto("/about");
  await page.getByRole("tab").nth(6).click();
  await page.getByRole("tabpanel").getByRole("link", { name: "SPEC-confidence.md › The confidence matrix (per key figure)" }).click();
  await expect(page.locator("#the-confidence-matrix-per-key-figure")).toBeInViewport();

  // a link inside a document stays in the app; an unknown path says so
  await page.goto("/docs/docs/acceptance/2026-10-11-evals.md");
  await page.locator(".doc-prose").getByRole("link", { name: "SPEC-evals.md" }).first().click();
  await expect(page).toHaveURL(/\/docs\/SPEC-evals\.md$/);
  // raw HTML in a document shows as text (SPEC-posting's "<analyst>" placeholder)
  await page.goto("/docs/SPEC-posting.md");
  await expect(page.locator(".doc-prose").getByText("approved by <analyst> with the reason")).toBeVisible();
  await page.goto("/docs/.env");
  await expect(page.getByRole("alert")).toContainText("There is no document at .env");
});

test("every evidence link in the showcase opens a real document, run or page", async ({ page }) => {
  const evidence = [...SKETCH_STEPS.flatMap((s) => s.evidence), ...IMPROVEMENT_LOOP.evidence, ...REQUIREMENTS.flatMap((r) => r.evidence),
    ...LOOP_TIMELINE.flatMap((t) => t.evidence), ...PROCESS_STEPS.map((s) => s.example)];
  for (const href of [...new Set(evidence.map(hrefFor))]) {
    await page.goto(href);
    await expect(page.getByRole("status").filter({ hasText: /^Loading/ }), href).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Page not found"), href).toHaveCount(0);
    await expect(page.getByRole("alert"), href).toHaveCount(0);
    await expect(page.locator("main").getByRole("heading").first(), href).toBeVisible();
  }
});

// SPEC-showcase criterion 6, readable contrast; the layout at 1280x720 and on a phone is checked on the public site
// (e2e/snapshot.spec.ts), which also writes the screenshots.
const SHOWCASE_PAGES = ["/about", "/tour", "/evals", "/decisions", "/process", "/docs/SPEC-evals.md"];
const ready = async (page: import("@playwright/test").Page) => {
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("main h2").first()).toBeVisible();
};

test("text contrast meets WCAG AA on every showcase page", async ({ page }) => {
  for (const path of SHOWCASE_PAGES) {
    await page.goto(path);
    await ready(page);
    const failures = await page.evaluate(() => {
      // Any CSS colour (Tailwind 4 uses oklch) to sRGB + alpha, converted by the browser itself.
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const rgba = (c: string): number[] => {
        if (!ctx) return [0, 0, 0, 1];
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const lum = ([r = 0, g = 0, b = 0]: number[]) => {
        const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const background = (el: Element | null): number[] => {
        for (let e = el; e; e = e.parentElement) {
          const c = rgba(getComputedStyle(e).backgroundColor);
          if ((c[3] ?? 0) > 0.5) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const out: string[] = [];
      for (const el of document.querySelectorAll("main *")) {
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        const box = el.getBoundingClientRect();
        if (!own || box.width === 0 || box.height === 0 || el.closest(".sr-only")) continue;
        const style = getComputedStyle(el);
        const [l1, l2] = [lum(rgba(style.color).slice(0, 3)), lum(background(el))];
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)} "${el.textContent?.trim().slice(0, 40)}" (${rgba(style.color).slice(0, 3).join(",")} on ${background(el).join(",")})`);
      }
      return out;
    });
    expect(failures, path).toEqual([]);
  }
});

test("the showcase works from the keyboard alone: Tab reaches the header and the tour steps, Enter follows them", async ({ page }) => {
  await page.goto("/tour");
  await ready(page);
  const reach = async (name: RegExp | string, max = 40) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (typeof name === "string" ? focused === name : name.test(focused)) return;
    }
    throw new Error(`Tab never reached ${String(name)}`);
  };
  await reach("Evals");
  await reach(/^1The inbox/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("a malformed #hash in a link does not take the app down (review finding)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/decisions#%E0%A4%A");
  await expect(page.getByRole("heading", { name: "Decisions", level: 2 })).toBeVisible();
  expect(errors).toEqual([]);
});
