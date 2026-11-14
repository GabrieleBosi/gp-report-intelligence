import { describe, expect, it } from "vitest";
import { assess, type AssessInput } from "../../../core/confidence/assess.ts";
import { compareReadB, type ReadBOutput } from "../../../core/confidence/compare.ts";
import { POLICY } from "../../../core/confidence/policy.ts";
import type { Classification } from "../../../core/pipeline/classify.ts";
import { normalizeRaw } from "../../../core/pipeline/normalize-step.ts";
import type { RawExtraction } from "../../../core/pipeline/prompts/extract.ts";

const classification: Classification = {
  gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", period_end: "2026-06-30", report_type: "quarterly_report",
  currency: "EUR", unit_statement: "all amounts in EUR m", evidence_page: 1, gp_status: "known", known_fund_id: "f", missing: [],
};
const v = (raw: string | null, page: number | null = 1) => ({ raw, page });
const company = (name: string, value: string) => ({
  name, country: "AT", sector: "Industrials", investment_date: null,
  invested: v("100.0", 2), realized: v("0.0", 2), unrealized: v(value, 2), total_value: v(value, 2),
  gross_moic: v(`${(Number(value) / 100).toFixed(2)}x`, 2),
});

// Consistent: TVPI (60+420.8)/330.5 = 1.45, DPI 0.18, RVPI 1.27; companies sum to 420.8.
function rawA(fund: Partial<RawExtraction["fund"]> = {}, extra: Partial<RawExtraction> = {}): RawExtraction {
  return {
    readMode: "text", visionFields: [],
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.45x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: v("7.1%"), ...fund },
    portfolio: { companies: [company("A GmbH", "140.3"), company("B AG", "140.2"), company("C Oy", "140.3")] },
    operating: { companies: [] }, qualitative: { key_updates: [], outlook: null }, ...extra,
  };
}

// Read B agrees with read A unless told otherwise.
function readB(fund: Partial<ReadBOutput["fund"]> = {}, companies?: ReadBOutput["companies"]): ReadBOutput {
  return {
    fund: { commitment: v("500.0"), paid_in: v("330.5"), distributions: v("60.0"), nav: v("420.8"), tvpi: v("1.45x"), dpi: v("0.18x"), ...fund },
    companies: companies ?? [{ name: "A GmbH", total_value: v("140.3", 2) }, { name: "B AG", total_value: v("140.2", 2) }, { name: "C Oy", total_value: v("140.3", 2) }],
  };
}

function input(a: RawExtraction, b: ReadBOutput | null = readB(), c: Classification = classification): AssessInput {
  const { extraction, checks, issues } = normalizeRaw(a, c);
  return { classification: c, raw: a, extraction, checks, issues, readB: b && compareReadB(b, a, c) };
}
const field = (result: ReturnType<typeof assess>, path: string) => result.fields.find((f) => f.path === path);

describe("assess: the confidence matrix (per key figure)", () => {
  it("checks pass + reads agree -> high; all high -> auto_post", () => {
    const result = assess(input(rawA()));

    expect(field(result, "fund.nav")).toMatchObject({ checks: "pass", reads: "agree", level: "high" });
    expect(result).toMatchObject({ level: "high", route: "auto_post", policy: POLICY.version });
    expect(POLICY.version).toBe("policy@3");
  });

  it("checks pass + reads disagree -> low, likely a misread, showing both printed values", () => {
    const result = assess(input(rawA(), readB({ distributions: v("66.0") })));

    expect(field(result, "fund.distributions")).toMatchObject({ checks: "pass", reads: "disagree", level: "low" });
    expect(field(result, "fund.distributions")?.reason).toMatch(/misread.*60\.0.*66\.0|60\.0.*66\.0.*misread/s);
    expect(result.route).toBe("review");
  });

  it("checks fail + reads agree -> low: the report itself may be inconsistent (trap 1)", () => {
    const result = assess(input(rawA({ tvpi: v("1.57x") }), readB({ tvpi: v("1.57x") })));

    expect(field(result, "fund.tvpi")).toMatchObject({ checks: "fail", reads: "agree", level: "low" });
    expect(field(result, "fund.tvpi")?.reason).toMatch(/report itself may be inconsistent/);
    expect(result.route).toBe("review");
  });

  it("checks fail + reads disagree -> low, showing both values", () => {
    const result = assess(input(rawA({ tvpi: v("1.57x") }), readB({ tvpi: v("1.45x") })));

    expect(field(result, "fund.tvpi")).toMatchObject({ checks: "fail", reads: "disagree", level: "low" });
    expect(field(result, "fund.tvpi")?.reason).toMatch(/1\.57x.*1\.45x/);
  });
});

describe("assess: the not-high cases", () => {
  it("a figure filled by the vision fallback is medium: two image reads are not independent", () => {
    const result = assess(input(rawA({}, { visionFields: ["fund.nav"] })));

    expect(field(result, "fund.nav")).toMatchObject({ reads: "correlated", level: "medium", flags: ["vision_fallback"] });
    expect(result).toMatchObject({ level: "medium", route: "review" });
  });

  it("a footnoted key figure is medium and never auto-posted", () => {
    const result = assess(input(rawA({ nav: v("420.8¹") })));

    expect(field(result, "fund.nav")).toMatchObject({ level: "medium", flags: ["footnote"] });
    expect(field(result, "fund.nav")?.reason).toMatch(/footnote/);
    expect(result.route).toBe("review");
  });

  it("a footnote marker seen only by read B also keeps the figure from auto-posting (policy@3; held-out restatement)", () => {
    const result = assess(input(rawA({ nav: v("420.8") }), readB({ nav: v("420.8¹") })));

    expect(field(result, "fund.nav")).toMatchObject({ reads: "agree", level: "medium", flags: ["footnote"] });
    expect(field(result, "fund.nav")?.reason).toMatch(/second read shows a footnote marker the first read missed/);
    expect(result.route).toBe("review");
  });

  it.each(["420.8*", "420.8 [2]", "420.8 (1)", "420.8²"])("recognizes the footnote marker in %j", (printed) => {
    expect(field(assess(input(rawA({ nav: v(printed) }))), "fund.nav")?.flags).toContain("footnote");
  });

  it("does not mistake a negative in parentheses for a footnote", () => {
    expect(field(assess(input(rawA({ distributions: v("(60.0)") }))), "fund.distributions")?.flags).not.toContain("footnote");
  });

  it("a figure the second read did not find is medium", () => {
    const result = assess(input(rawA(), readB({ nav: v(null, null) })));

    expect(field(result, "fund.nav")).toMatchObject({ reads: "unavailable", level: "medium" });
  });

  it("no second read at all makes every figure medium, and says that no second read was available", () => {
    const result = assess(input(rawA(), null));

    expect(result).toMatchObject({ level: "medium", route: "review" });
    expect(field(result, "fund.nav")?.reason).toBe("No independent second read was available for this document.");
  });

  it("a figure no check covers is medium", () => {
    const base = input(rawA());
    const result = assess({ ...base, checks: [] });

    expect(field(result, "fund.nav")).toMatchObject({ checks: "none", level: "medium" });
  });

  it("a missing key figure is low", () => {
    const result = assess(input(rawA({ dpi: v(null, null) }), readB({ dpi: v(null, null) })));

    expect(field(result, "fund.dpi")).toMatchObject({ level: "low", flags: ["missing"] });
  });

  it("a key figure with a normalization issue is low", () => {
    const result = assess(input(rawA({ nav: v("four hundred") })));

    expect(field(result, "fund.nav")).toMatchObject({ level: "low", flags: expect.arrayContaining(["normalization_issue"]) });
  });

  it("company total values are key figures too, aligned with read B by name", () => {
    const result = assess(input(rawA(), readB({}, [{ name: "a gmbh", total_value: v("140.3", 2) }, { name: "B AG", total_value: v("141.2", 2) }])));

    expect(field(result, "portfolio_companies[0].total_value")).toMatchObject({ reads: "agree", level: "high" });
    expect(field(result, "portfolio_companies[1].total_value")).toMatchObject({ reads: "disagree", level: "low" });
    expect(field(result, "portfolio_companies[2].total_value")).toMatchObject({ reads: "unavailable", level: "medium" });
  });
});

describe("assess: routing", () => {
  it("never auto-posts an uploaded document (since policy@2): clean uploads go to review, with the reason", () => {
    const corpus = assess(input(rawA()));
    const upload = assess({ ...input(rawA()), source: "upload" });

    expect(corpus.route).toBe("auto_post");
    expect(upload).toMatchObject({ route: "review", level: "high", policy: "policy@3" });
    expect(upload.reasons).toEqual(["Uploaded documents are always reviewed by an analyst before posting (policy@3)."]);
  });

  it("triages an unknown GP whatever the confidence", () => {
    const result = assess(input(rawA(), readB(), { ...classification, gp_status: "unknown", known_fund_id: null }));

    expect(result.route).toBe("triage");
    expect(result.reasons[0]).toMatch(/not in the registry of known funds/);
  });

  it("triages an incomplete classification", () => {
    const result = assess(input(rawA(), readB(), { ...classification, currency: null, missing: ["currency"] }));

    expect(result.route).toBe("triage");
    expect(result.reasons.join(" ")).toMatch(/currency/);
  });

  it("sends a failed check on non-key figures (EBITDA above revenue) to review, naming the check", () => {
    const a = rawA();
    a.operating.companies = [{ name: "A GmbH", revenue_ltm: v("30.0", 3), ebitda_ltm: v("72.4", 3), net_debt: v("1.0", 3) }];

    const result = assess(input(a));

    expect(result.level).toBe("high");
    expect(result.route).toBe("review");
    expect(result.reasons).toContainEqual(expect.stringMatching(/^Check failed: .*EBITDA.*revenue/));
  });

  it("lists every non-high figure's reason for the analyst", () => {
    // Commitment is not part of the TVPI identity, so its own (vision-fallback) reason shows; a figure in a failed
    // check takes the check's reason first, as in the spec's table, and keeps the vision_fallback flag.
    const result = assess(input(rawA({ tvpi: v("1.57x") }, { visionFields: ["fund.commitment", "fund.nav"] }), readB({ tvpi: v("1.57x") })));

    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^TVPI: .*inconsistent/), expect.stringMatching(/^Total commitments: .*vision fallback/),
    ]));
    expect(field(result, "fund.nav")).toMatchObject({ level: "low", flags: ["vision_fallback"] });
  });
});
