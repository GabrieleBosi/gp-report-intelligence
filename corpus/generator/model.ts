// Seeded fund generator: builds a fund that is consistent by construction, then returns what each quarterly
// report would print. Economics first, rendering later (SPEC-corpus "Generation"); traps are injected at render time.
import type { Extraction, Money, PortfolioCompany, Ratio } from "../../core/schema.ts";
import type { GpProfile } from "./profiles.ts";

// mulberry32: tiny, fast and deterministic across platforms, unlike Math.random.
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const LEGAL_FORM: Record<string, string> = {
  DE: "GmbH", AT: "GmbH", CH: "AG", IT: "S.p.A.", US: "Inc.", GB: "Ltd", CA: "Inc.",
  SE: "AB", NO: "AS", DK: "A/S", FI: "Oy", FR: "SAS",
};
// Invented syllables, so generated names read as plausible but belong to no real company.
const SYLLABLES = ["vel", "mor", "quin", "ta", "ro", "bren", "vik", "sal", "dor", "ny", "lu", "cen", "tra", "pha", "zel", "ori", "kas", "mira", "tov", "lin"];

type CompanyState = {
  name: string;
  sector: string;
  country: string;
  investment_date: string;
  invested: number;
  realized: number;
  unrealized: number;
  revenue: number;
  margin: number;
  leverage: number; // net debt / EBITDA
};

const KEY_UPDATE_TEMPLATES = [
  (c: string) => `${c} completed a bolt-on acquisition of a regional competitor`,
  (c: string) => `${c} appointed a new CFO`,
  (c: string) => `${c} refinanced its senior debt at a lower margin`,
  (c: string) => `${c} entered two new export markets`,
  (c: string) => `${c} launched a cost programme targeting 150 bps of margin`,
];

export function generateFund(profile: GpProfile, seed: number): Extraction[] {
  const rng = createRng(seed ^ hashString(profile.id));
  const between = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
  const round = (value: number) => Math.round(value / profile.roundTo) * profile.roundTo;

  const companies = createCompanies(profile, rng, between, pick);
  const navBridge = between(-0.06, 0.02); // carry accrual and other net assets: stable per fund, inside the 10% check
  const feeRate = 0.0175;

  return profile.periods.map((periodEnd, quarterIndex) => {
    if (quarterIndex > 0) evolveOneQuarter(companies, rng, between);

    const years = Math.max(1, (Date.parse(periodEnd) - Date.UTC(profile.vintage, 0, 1)) / (365.25 * 86_400_000));
    const money = (value: number, page: number): Money => ({ value: round(value), currency: profile.currency, source: { page } });
    const ratio = (value: number, page: number, decimals = 2): Ratio => ({ value: Number(value.toFixed(decimals)), source: { page } });

    const portfolio: PortfolioCompany[] = companies.map((c) => {
      const realized = round(c.realized);
      const unrealized = round(c.unrealized);
      const invested = round(c.invested);
      const ebitda = c.revenue * c.margin;
      return {
        name: c.name, sector: c.sector, country: c.country, investment_date: c.investment_date,
        invested: money(invested, profile.layout.companies),
        realized: money(realized, profile.layout.companies),
        unrealized: money(unrealized, profile.layout.companies),
        total_value: money(realized + unrealized, profile.layout.companies),
        gross_moic: ratio((realized + unrealized) / invested, profile.layout.companies),
        revenue_ltm: money(c.revenue, profile.layout.operating),
        ebitda_ltm: money(ebitda, profile.layout.operating),
        net_debt: money(ebitda * c.leverage, profile.layout.operating),
      };
    });

    // Fund totals are derived from the rounded, printed components, the way a GP's report ties out.
    const sumOf = (pick: (c: PortfolioCompany) => Money | null) => portfolio.reduce((s, c) => s + (pick(c)?.value ?? 0), 0);
    const commitment = round(profile.commitment);
    const paidIn = round(sumOf((c) => c.invested) + profile.commitment * feeRate * years);
    const distributions = round(sumOf((c) => c.realized) * 0.97);
    const nav = round(sumOf((c) => c.unrealized) * (1 + navBridge));
    const page = profile.layout.fund;
    const tvpi = (distributions + nav) / paidIn;

    return {
      classification: {
        gp_name: profile.gp_name, fund_name: profile.fund_name, period_end: periodEnd,
        report_type: profile.reportType ?? "quarterly_report", currency: profile.currency,
      },
      fund: {
        commitment: money(commitment, page),
        paid_in: money(paidIn, page),
        unfunded: money(commitment - paidIn, page),
        distributions: money(distributions, page),
        nav: money(nav, page),
        tvpi: ratio(tvpi, page),
        dpi: ratio(distributions / paidIn, page),
        rvpi: ratio(nav / paidIn, page),
        net_irr: ratio(Math.pow(Math.max(tvpi, 0.01), 1 / years) - 1, page, 3),
      },
      portfolio_companies: portfolio,
      qualitative: {
        key_updates: [0, 1].map(() => pick(KEY_UPDATE_TEMPLATES)(pick(companies).name)),
        outlook: "We expect continued operational progress across the portfolio and selective exit opportunities in the next twelve months.",
      },
    };
  });
}

function createCompanies(profile: GpProfile, rng: () => number, between: (lo: number, hi: number) => number,
  pick: <T>(items: readonly T[]) => T): CompanyState[] {
  const deployed = profile.commitment * between(0.55, 0.85);
  const weights = Array.from({ length: profile.companyCount }, () => between(0.5, 1.5));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const names = new Set<string>();

  return weights.map((weight) => {
    const country = pick(profile.countries);
    let name: string;
    do {
      const word = pick(SYLLABLES) + pick(SYLLABLES) + (rng() < 0.5 ? pick(SYLLABLES) : "");
      name = `${word.charAt(0).toUpperCase()}${word.slice(1)} ${LEGAL_FORM[country] ?? "SA"}`;
    } while (names.has(name));
    names.add(name);

    const invested = (deployed * weight) / weightSum;
    const multiple = between(0.8, 2.6);
    const realizedShare = rng() < 0.3 ? between(0.2, 0.6) : 0;
    const year = profile.vintage + Math.floor(rng() * 2);
    const month = 1 + Math.floor(rng() * 12);
    const revenue = invested * between(1.5, 4);

    return {
      name, country, sector: pick(profile.sectors),
      investment_date: `${year}-${String(month).padStart(2, "0")}-15`,
      invested,
      realized: invested * multiple * realizedShare,
      unrealized: invested * multiple * (1 - realizedShare),
      revenue, margin: between(0.08, 0.3), leverage: between(-0.5, 4.5),
    };
  });
}

// One quarter of value drift, operating growth and at most one partial exit (cumulative realized never shrinks).
function evolveOneQuarter(companies: CompanyState[], rng: () => number, between: (lo: number, hi: number) => number): void {
  for (const c of companies) {
    c.unrealized *= 1 + between(-0.06, 0.1);
    c.revenue *= 1 + between(0, 0.04);
  }
  if (rng() < 0.5) {
    const exiting = companies[Math.floor(rng() * companies.length)];
    if (exiting) {
      const sold = exiting.unrealized * between(0.1, 0.3);
      exiting.unrealized -= sold;
      exiting.realized += sold;
    }
  }
}
