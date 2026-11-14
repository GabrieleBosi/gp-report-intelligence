// Sketch step 9 end to end (SPEC-review success criteria 2 and 3), against netlify dev and the live database. It starts
// fresh runs (cached LLM answers, $0) so the document is waiting again, then writes real, append-only decisions.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./live.ts";

async function freshRun(request: APIRequestContext, filename: string): Promise<string> {
  const { documents } = await (await request.get("/api/documents")).json() as { documents: { id: string; filename: string }[] };
  const doc = documents.find((d) => d.filename === filename);
  if (!doc) throw new Error(`${filename} is not on the site`);
  const { run_id: runId } = await (await request.post("/api/runs", { data: { document_id: doc.id } })).json() as { run_id: string };
  await request.post(`/api/runs/${runId}/execute`);
  await expect.poll(async () => (await (await request.get(`/api/runs/${runId}`)).json()).run.status, { timeout: 90_000 }).toBe("needs_review");
  return runId;
}

test("trap 1 from the queue: the analyst checks page 1 and approves the inconsistent report with a reason, which posts it", async ({ page, request }) => {
  await freshRun(request, "harbourline-ii-2025q3-tvpi-misprint.pdf");

  await page.goto("/review");
  await page.getByRole("link", { name: /harbourline-ii-2025q3-tvpi-misprint\.pdf/ }).click();
  await expect(page.getByRole("img", { name: "Page 1 of harbourline-ii-2025q3-tvpi-misprint.pdf" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Your name").fill("E2E analyst");

  for (const label of ["Paid-in capital", "Cumulative distributions", "Net asset value", "TVPI"]) {
    await page.getByRole("button", { name: `Accept ${label}` }).click();
    await expect(page.getByRole("listitem").filter({ hasText: label }).getByText("accepted as printed")).toBeVisible();
  }
  await expect(page.getByText("required: checks still fail: tvpi_inconsistent")).toBeVisible();
  await page.getByLabel(/Reason/).fill("Posted as printed; GP asked to restate TVPI (E2E).");
  await page.getByRole("button", { name: "Approve for posting" }).click();

  await expect(page.getByText("posted", { exact: true })).toBeVisible(); // an approval posts right away (step 8)
  // The decision log entry (the reason also appears in the posting panel since an approval posts).
  await expect(page.getByRole("listitem").filter({ hasText: /^E2E analyst approved: “Posted as printed; GP asked to restate TVPI \(E2E\)\.”/ })).toBeVisible();
});

test("a scan's OCR-lost EBITDA decimals are corrected on screen and the check clears", async ({ page, request }) => {
  const runId = await freshRun(request, "harbourline-ii-2025q3-tvpi-misprint-scan.pdf");

  await page.goto(`/runs/${runId}`);
  await page.getByLabel("Your name").fill("E2E analyst");
  await expect(page.getByText(/checks still fail: .*company_ebitda_exceeds_revenue/)).toBeVisible();
  for (const [company, value] of [["Luori Inc.", "72.4"], ["Tovbren Inc.", "22.2"], ["Tracen Inc.", "17.5"]] as const) {
    await page.getByRole("button", { name: `Correct ${company}: EBITDA LTM` }).click();
    await page.getByLabel("Value as printed").fill(value);
    await page.getByLabel("Page", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText(new RegExp(`corrected portfolio_companies\\[\\d\\]\\.ebitda_ltm \\d+ → ${value.replace(".", "\\.")}`))).toBeVisible();
  }
  await expect(page.getByText("required: checks still fail: tvpi_inconsistent")).toBeVisible(); // only the real inconsistency is left
});
