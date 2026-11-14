import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedCorpus } from "../../corpus/seed-corpus.ts";
import { SPREADSHEET_MIME } from "../../core/documents.ts";
import { InMemoryStore } from "../support/in-memory-store.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("seedCorpus", () => {
  it("registers every labeled corpus document once, however often it runs", async () => {
    const store = new InMemoryStore();

    await seedCorpus(ROOT, store);
    const second = await seedCorpus(ROOT, store);

    const labels = await Promise.all((await readdir(path.join(ROOT, "corpus/labels")))
      .map(async (n) => JSON.parse(await readFile(path.join(ROOT, "corpus/labels", n), "utf8")) as { file: string }));
    const labeled = labels.map((l) => path.basename(l.file)).sort();
    expect(store.documents.map((d) => d.filename).sort()).toEqual(labeled);
    expect(store.audit).toHaveLength(labeled.length);
    expect(second.every((r) => !r.created)).toBe(true);
    expect(store.documents.find((d) => d.filename === "meridian-i-2026q2.xlsx")?.mime).toBe(SPREADSHEET_MIME);
  });

  it("stores descriptive corpus metadata but never the expected values", async () => {
    const store = new InMemoryStore();

    await seedCorpus(ROOT, store);
    const doc = store.documents.find((d) => d.filename === "alpenrose-iv-2026q2.pdf");

    expect(doc?.source).toBe("corpus");
    expect(doc?.corpus_meta).toEqual({
      doc_id: "alpenrose-iv-2026q2", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV",
      period_end: "2026-06-30", format: "native_pdf", split: "heldout",
    });
  });
});
