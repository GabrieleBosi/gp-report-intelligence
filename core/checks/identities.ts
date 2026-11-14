// Step 5 financial identities. Deterministic, cheap and explainable: signal A of the step-7 confidence model.
// Used twice: by the corpus verifier (labels must be consistent, traps must fail exactly as declared) and by the
// pipeline on extracted values. A check whose inputs were not extracted is "skipped", never "failed".
import type { Extraction, Money } from "../schema.ts";

export type CheckId =
  | "tvpi_inconsistent"
  | "dpi_inconsistent"
  | "rvpi_inconsistent"
  | "paid_in_exceeds_commitment"
  | "unfunded_inconsistent"
  | "nav_bridge_gap"
  | "company_value_inconsistent"
  | "company_moic_inconsistent"
  | "company_ebitda_exceeds_revenue"
  | "currency_mismatch"
  | "qoq_cumulative_decrease"
  | "qoq_commitment_changed"
  | "qoq_nav_jump";

export type CheckResult = {
  id: CheckId;
  status: "pass" | "fail" | "skipped";
  message: string;
  fields: string[]; // every schema path the check examined, e.g. "fund.tvpi" (step 7: these figures are covered)
  failing?: string[]; // when only some of them failed (company checks): the ones the critic should re-read
};

// Printed ratios carry two decimals, so each can be off by up to 0.005.
export const RATIO_TOLERANCE = 0.01;
export const UNFUNDED_TOLERANCE = 0.005; // share of commitment
// Fund NAV is net of carry accrual and includes cash/other net assets; portfolio values are gross. The bridge
// between the two is legitimately a few percent, so only a gap above 10% is a finding.
export const NAV_BRIDGE_TOLERANCE = 0.1;
export const COMPANY_VALUE_TOLERANCE = 0.005; // share of total value
export const CUMULATIVE_TOLERANCE = 0.001;
export const QOQ_NAV_MAX_CHANGE = 0.4;

const v = (money: { value: number } | null) => money?.value ?? null;
const result = (id: CheckId, ok: boolean, message: string, fields: string[]): CheckResult => ({
  id, status: ok ? "pass" : "fail", message: ok ? "ok" : message, fields,
});
const skipped = (id: CheckId, fields: string[]): CheckResult => ({ id, status: "skipped", message: "inputs not extracted", fields });

function ratioCheck(id: CheckId, name: string, ratioField: string, printed: number | null, numerator: number | null,
  paidIn: number | null, numeratorFields: string[]): CheckResult {
  const fields = [ratioField, ...numeratorFields, "fund.paid_in"];
  if (printed === null || numerator === null || !paidIn) return skipped(id, fields);
  const implied = numerator / paidIn;
  return result(id, Math.abs(printed - implied) <= RATIO_TOLERANCE,
    `${name} printed ${printed.toFixed(2)} but figures imply ${implied.toFixed(3)}`, fields);
}

function fundChecks({ fund, portfolio_companies: companies }: Extraction): CheckResult[] {
  const paidIn = v(fund.paid_in);
  const dist = v(fund.distributions);
  const nav = v(fund.nav);
  const commitment = v(fund.commitment);
  const unfunded = v(fund.unfunded);
  const checks: CheckResult[] = [
    ratioCheck("tvpi_inconsistent", "TVPI", "fund.tvpi", v(fund.tvpi),
      dist !== null && nav !== null ? dist + nav : null, paidIn, ["fund.distributions", "fund.nav"]),
    ratioCheck("dpi_inconsistent", "DPI", "fund.dpi", v(fund.dpi), dist, paidIn, ["fund.distributions"]),
    ratioCheck("rvpi_inconsistent", "RVPI", "fund.rvpi", v(fund.rvpi), nav, paidIn, ["fund.nav"]),
  ];

  const commitmentFields = ["fund.paid_in", "fund.commitment"];
  checks.push(paidIn === null || commitment === null
    ? skipped("paid_in_exceeds_commitment", commitmentFields)
    : result("paid_in_exceeds_commitment", paidIn <= commitment * (1 + CUMULATIVE_TOLERANCE),
      "paid-in exceeds commitment", commitmentFields));

  const unfundedFields = ["fund.unfunded", "fund.commitment", "fund.paid_in"];
  checks.push(unfunded === null || commitment === null || paidIn === null
    ? skipped("unfunded_inconsistent", unfundedFields)
    : result("unfunded_inconsistent", Math.abs(unfunded - (commitment - paidIn)) <= commitment * UNFUNDED_TOLERANCE,
      "unfunded differs from commitment minus paid-in", unfundedFields));

  const unrealized = companies.map((c) => v(c.unrealized));
  const bridgeFields = ["fund.nav", ...companies.map((_, i) => `portfolio_companies[${i}].unrealized`)];
  if (nav && nav > 0 && companies.length === 0) {
    // A fund with a NAV holds investments: an empty portfolio means the table was missed (the critic re-reads it).
    checks.push({ ...result("nav_bridge_gap", false, "the fund reports a NAV but no portfolio companies were extracted", ["fund.nav"]) });
  } else if (!nav || unrealized.some((u) => u === null)) {
    checks.push(skipped("nav_bridge_gap", bridgeFields));
  } else {
    const sum = unrealized.reduce<number>((a, b) => a + (b ?? 0), 0);
    const gap = Math.abs(sum - nav) / nav;
    checks.push(result("nav_bridge_gap", gap <= NAV_BRIDGE_TOLERANCE,
      `portfolio unrealized value is ${(gap * 100).toFixed(1)}% away from fund NAV`, bridgeFields));
  }
  return checks;
}

function companyChecks({ portfolio_companies: companies }: Extraction): CheckResult[] {
  const value = { examined: [] as string[], failing: [] as string[] };
  const moic = { examined: [] as string[], failing: [] as string[] };
  const ebitda = { examined: [] as string[], failing: [] as string[] };

  companies.forEach((c, i) => {
    const at = (f: string) => `portfolio_companies[${i}].${f}`;
    const [total, realized, unrealized, invested, multiple] =
      [v(c.total_value), v(c.realized), v(c.unrealized), v(c.invested), v(c.gross_moic)];
    if (total !== null && realized !== null && unrealized !== null) {
      const paths = [at("total_value"), at("realized"), at("unrealized")];
      value.examined.push(...paths);
      if (Math.abs(total - (realized + unrealized)) > Math.max(total * COMPANY_VALUE_TOLERANCE, 1)) value.failing.push(...paths);
    }
    if (multiple !== null && total !== null && invested) {
      const paths = [at("gross_moic"), at("total_value"), at("invested")];
      moic.examined.push(...paths);
      if (Math.abs(multiple - total / invested) > RATIO_TOLERANCE) moic.failing.push(...paths);
    }
    // Plausibility, not an identity: EBITDA can never exceed revenue (margin above 100%). Catches a lost decimal
    // point, typically from OCR (error analysis 2026-10-11-ocr-fund-names).
    const [revenue, earnings] = [v(c.revenue_ltm), v(c.ebitda_ltm)];
    if (revenue !== null && revenue > 0 && earnings !== null) {
      const paths = [at("ebitda_ltm"), at("revenue_ltm")];
      ebitda.examined.push(...paths);
      if (earnings > revenue) ebitda.failing.push(...paths);
    }
  });

  const companyResult = (id: CheckId, message: string, { examined, failing }: { examined: string[]; failing: string[] }): CheckResult =>
    examined.length === 0 ? skipped(id, [])
      : failing.length === 0 ? result(id, true, message, examined)
      : { ...result(id, false, message, examined), failing };
  return [
    companyResult("company_value_inconsistent", "company total value is not realized plus unrealized", value),
    companyResult("company_moic_inconsistent", "company gross MOIC does not match total value over invested", moic),
    companyResult("company_ebitda_exceeds_revenue", "company EBITDA exceeds its revenue", ebitda),
  ];
}

function currencyCheck(extraction: Extraction): CheckResult {
  const expected = extraction.classification.currency;
  const amounts: [string, Money | null][] = [
    ...Object.entries(extraction.fund).map(([k, f]) => [`fund.${k}`, f && "currency" in f ? f : null] as [string, Money | null]),
    ...extraction.portfolio_companies.flatMap((c, i) =>
      (["invested", "realized", "unrealized", "total_value", "revenue_ltm", "ebitda_ltm", "net_debt"] as const)
        .map((k) => [`portfolio_companies[${i}].${k}`, c[k]] as [string, Money | null])),
  ];
  const mismatched = amounts.filter(([, money]) => money !== null && money.currency !== expected).map(([path]) => path);
  return result("currency_mismatch", mismatched.length === 0, `amounts not in report currency ${expected}`, mismatched);
}

function quarterOnQuarter(current: Extraction, previous: Extraction | null): CheckResult[] {
  const cumulativeFields = ["fund.paid_in", "fund.distributions"];
  const commitmentFields = ["fund.commitment"];
  const navFields = ["fund.nav"];
  if (!previous) {
    return [skipped("qoq_cumulative_decrease", cumulativeFields), skipped("qoq_commitment_changed", commitmentFields),
      skipped("qoq_nav_jump", navFields)];
  }
  const shrank = (now: number | null, before: number | null) =>
    now !== null && before !== null && now < before * (1 - CUMULATIVE_TOLERANCE);
  const [cur, prev] = [current.fund, previous.fund];
  const decreased = cumulativeFields.filter((_, i) =>
    i === 0 ? shrank(v(cur.paid_in), v(prev.paid_in)) : shrank(v(cur.distributions), v(prev.distributions)));

  const [commitNow, commitBefore] = [v(cur.commitment), v(prev.commitment)];
  const [navNow, navBefore] = [v(cur.nav), v(prev.nav)];
  return [
    result("qoq_cumulative_decrease", decreased.length === 0, "a cumulative figure decreased since last quarter", decreased),
    commitNow === null || commitBefore === null
      ? skipped("qoq_commitment_changed", commitmentFields)
      : result("qoq_commitment_changed", Math.abs(commitNow - commitBefore) <= commitBefore * CUMULATIVE_TOLERANCE,
        "commitment changed since last quarter", commitmentFields),
    navNow === null || !navBefore
      ? skipped("qoq_nav_jump", navFields)
      : result("qoq_nav_jump", Math.abs(navNow - navBefore) / navBefore <= QOQ_NAV_MAX_CHANGE,
        `NAV moved ${(((navNow - navBefore) / navBefore) * 100).toFixed(0)}% in one quarter`, navFields),
  ];
}

export function runIdentityChecks(current: Extraction, previous: Extraction | null = null): CheckResult[] {
  return [...fundChecks(current), ...companyChecks(current), currencyCheck(current), ...quarterOnQuarter(current, previous)];
}
