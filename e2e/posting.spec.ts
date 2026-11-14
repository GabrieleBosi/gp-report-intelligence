// Sketch step 8 end to end (SPEC-posting criteria 1, 2 and 4), against netlify dev and the live database. Fresh runs
// (cached LLM answers, $0); posts to the mock portfolio system are real and append-only, and identical re-posts are
// recorded as "unchanged", so the test can run again.
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./live.ts";

async function freshRun(request: APIRequestContext, filename: string, until: string[]): Promise<string> {
  const { documents } = await (await request.get("/api/documents")).json() as { documents: { id: string; filename: string }[] };
  const doc = documents.find((d) => d.filename === filename);
  if (!doc) throw new Error(`${filename} is not on the site`);
  const { run_id: runId } = await (await request.post("/api/runs", { data: { document_id: doc.id } })).json() as { run_id: string };
  await request.post(`/api/runs/${runId}/execute`);
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).run.status, { timeout: 90_000 }).toMatch(new RegExp(`^(${until.join("|")})$`));
  return runId;
}

async function acceptAndApprove(page: Page, labels: string[], reason: string) {
  await page.getByLabel("Your name").fill("E2E analyst");
  for (const label of labels) await page.getByRole("button", { name: `Accept ${label}` }).click();
  await page.getByLabel(/Reason/).fill(reason);
  await page.getByRole("button", { name: "Approve for posting" }).click();
  await expect(page.getByText("posted", { exact: true })).toBeVisible();
}

test("a clean report is posted with no human step and appears in the portfolio system", async ({ page, request }) => {
  const runId = await freshRun(request, "nordkap-iii-2025q4.pdf", ["posted"]);

  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole("heading", { name: /Posted to the portfolio system/ })).toBeVisible();
  await expect(page.getByText(/auto-posted under policy@3/)).toBeVisible();
  await page.getByRole("link", { name: "Portfolio system (mock)" }).click();
  await expect(page.getByRole("row", { name: /Nordkap Mid-Market III.*Q4 2025/ })).toContainText(/auto-post \(policy@\d+\)/); // an identical re-post is "unchanged": the record keeps its first clearance
});

test("trap 1 approved in the review screen is posted, with the analyst and the reason in the record", async ({ page, request }) => {
  const runId = await freshRun(request, "harbourline-ii-2025q3-tvpi-misprint.pdf", ["needs_review"]);

  await page.goto(`/runs/${runId}`);
  await acceptAndApprove(page, ["Paid-in capital", "Cumulative distributions", "Net asset value", "TVPI"], "Posted as printed; GP asked to restate TVPI (E2E).");
  await expect(page.getByText(/approved by E2E analyst: “Posted as printed; GP asked to restate TVPI \(E2E\)\.”/)).toBeVisible();
});

test("the same fund and quarter with different figures becomes a new version and supersedes the current one", async ({ page, request }) => {
  // The scan of trap 1 reports the same fund and quarter; OCR left company country codes unreadable, so its figures differ.
  // Order matters on the shared database: the trap-1 test above posts the clean figures first. Run alone, this posting
  // matches the current version and is (correctly) "unchanged", with no new version.
  const runId = await freshRun(request, "harbourline-ii-2025q3-tvpi-misprint-scan.pdf", ["needs_review"]);

  await page.goto(`/runs/${runId}`);
  await page.getByLabel("Your name").fill("E2E analyst");
  for (const [company, value] of [["Luori Inc.", "72.4"], ["Tovbren Inc.", "22.2"], ["Tracen Inc.", "17.5"]] as const) {
    await page.getByRole("button", { name: `Correct ${company}: EBITDA LTM` }).click();
    await page.getByLabel("Value as printed").fill(value);
    await page.getByLabel("Page", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText(new RegExp(`→ ${value.replace(".", "\\.")}`))).toBeVisible();
  }
  await acceptAndApprove(page, ["Paid-in capital", "Cumulative distributions", "Net asset value", "TVPI"], "Scan checked against page 1; EBITDA decimals restored (E2E).");
  // Re-runnable on the shared database: earlier runs left versions behind, so assert n+1 supersedes n, whatever n is.
  const summary = await page.getByText(/Record version \d+ \(supersedes version \d+\)/).textContent();
  const [, version, superseded] = summary?.match(/Record version (\d+) \(supersedes version (\d+)\)/) ?? [];
  expect(Number(version)).toBe(Number(superseded) + 1);

  await page.goto("/portfolio");
  await page.getByRole("button", { name: /^Show \d+ earlier versions? of Harbourline Growth II, Q3 2025$/ }).click();
  const versions = page.getByRole("row").filter({ hasText: /USD 633\.7m/ });
  await expect(versions.filter({ hasText: `v${version} · current` })).toHaveCount(1);
  await expect(versions.filter({ hasText: `v${superseded} · superseded` })).toHaveCount(1);
  await expect(versions.filter({ hasText: "· current" })).toHaveCount(1);
});

test("the portfolio page shows each record's current version and folds the earlier ones", async ({ page }) => {
  await page.goto("/portfolio");
  const table = page.getByRole("table");
  await expect(table.getByRole("row").filter({ hasText: "· superseded" })).toHaveCount(0);
  const toggle = page.getByRole("button", { name: /^Show \d+ earlier versions? of Nordkap Mid-Market III, Q3 2025$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: /^Hide \d+ earlier versions? of Nordkap Mid-Market III, Q3 2025$/ })).toHaveAttribute("aria-expanded", "true");
  await expect(table.getByRole("row").filter({ hasText: "v1 · superseded" }).filter({ hasText: /EUR 364\.0m/ })).toHaveCount(1);
  expect(await table.getByRole("row").filter({ hasText: "· current" }).count()).toBeGreaterThanOrEqual(9);
});
