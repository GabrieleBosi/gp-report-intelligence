// Smoke test of the demo flows against `netlify dev` with the real (synthetic-data) Supabase project. Local only: it
// needs the secrets in .env. The run it starts uses a clean dev document whose LLM answers are cached ($0).
import { expect, test } from "./live.ts";

test("the app shell and the health check are up", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByText("GP Report Intelligence")).toBeVisible();
  const health = await (await request.get("/api/health")).json();
  expect(health).toMatchObject({ status: "ok", checks: { db: "ok", storage: "ok" } });
});

test("the Documents page lists the corpus with its split", async ({ page }) => {
  await page.goto("/");
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /alpenrose-iv-2026q2\.pdf/ })).toContainText("held out");
  await expect(table.getByRole("row", { name: /meridian-i-2025q4\.xlsx/ })).toContainText("Excel");
  expect(await table.getByRole("row").count()).toBeGreaterThanOrEqual(19); // header + 18 corpus documents
});

test("a run on a clean dev report ends ready to post, with the confidence evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run the pipeline on alpenrose-iv-2026q1.pdf" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Ready to post" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("table", { name: /Confidence per key figure/ })).toContainText("Net asset value");
});

test("an upload that is not a PDF or workbook is rejected with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Upload a report").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\x90\x00 not a pdf") });
  await expect(page.getByRole("alert")).toHaveText("report.pdf is not a PDF or Excel (.xlsx) file. Only those formats are accepted.");
});
