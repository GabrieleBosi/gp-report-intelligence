import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runIdentityChecks } from "../../core/checks/identities.ts";
import { CorpusLabel } from "../../core/schema.ts";
import { formatAmount } from "../../corpus/generator/format.ts";
import { profileById } from "../../corpus/generator/profiles.ts";
import { extractTextPages } from "../../netlify/lib/pdf.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const load = async (docId: string) => {
  const label = CorpusLabel.parse(JSON.parse(await readFile(path.join(ROOT, `corpus/labels/${docId}.json`), "utf8")));
  const pages = await extractTextPages(new Uint8Array(await readFile(path.join(ROOT, label.file))));
  return { label, pages };
};
const failed = (label: CorpusLabel) => runIdentityChecks(label.expected).filter((c) => c.status === "fail").map((c) => c.id).sort();

describe("trap 1: TVPI misprint", () => {
  it("prints a TVPI inconsistent with its own figures, so exactly one identity fails, and expects review", async () => {
    const { label } = await load("harbourline-ii-2025q3-tvpi-misprint");

    expect(label.trap).toBe("tvpi_misprint");
    expect(failed(label)).toEqual(["tvpi_inconsistent"]);
    expect(label.expected_route).toBe("review");
  });
});

describe("trap 2: NAV only in a chart", () => {
  it("leaves the NAV out of the text layer, so only a vision read can find it", async () => {
    const { label, pages } = await load("alpenrose-iv-2025q3-chart-nav");
    const nav = label.expected.fund.nav;

    expect(label.trap).toBe("chart_nav");
    expect(nav?.source.page).toBe(1);
    expect(pages[0]).not.toContain(formatAmount(nav?.value ?? NaN, profileById("alpenrose-iv").style));
    expect(pages[0]).not.toMatch(/Net asset value\s+\d/);
    expect(failed(label)).toEqual([]);
  });
});

describe("trap 3: restatement footnote", () => {
  it("prints the original NAV with a footnote giving the revised value; the label records the revised value", async () => {
    const { label, pages } = await load("nordkap-iii-2025q3-restatement");
    const style = profileById("nordkap-iii").style;
    const revised = formatAmount(label.expected.fund.nav?.value ?? NaN, style);

    expect(label.trap).toBe("restatement");
    expect(pages[0]).toMatch(/¹|\(1\)/);
    expect(pages[0]).toContain(revised);
    expect(failed(label)).toEqual(["rvpi_inconsistent", "tvpi_inconsistent"]);
  });
});

describe("unknown GP: Tessera", () => {
  it("is labeled for triage and puts the portfolio on the same page as the fund figures", async () => {
    const { label, pages } = await load("tessera-seed-i-2026q2");

    expect(label.expected_route).toBe("triage");
    expect(label.expected.portfolio_companies[0]?.total_value?.source.page).toBe(1);
    expect(pages).toHaveLength(2);
    expect(failed(label)).toEqual([]);
  });
});
