// Renders Meridian's quarterly capital account statement as a workbook: exact USD amounts in numeric cells, ratios and
// IRR as numbers with a display format, investment dates as real Excel dates. The cover letter (narrative) is the
// third sheet, so the document stays one file. Labels cite sheet numbers as source pages (profile.layout).
import type { Extraction, Money } from "../../core/schema.ts";
import { formatLongDate, formatPeriodLabel } from "./format.ts";
import { writeWorkbook, type Cell } from "./xlsx.ts";

const AMOUNT = "#,##0;-#,##0";
const MULTIPLE = '0.00"x"';
const PERCENT = "0.0%";
const FOOTER_NOTE = "Fictional fund - synthetic data generated for a case-study prototype; not a real report";

export async function renderCapitalAccountWorkbook(report: Extraction): Promise<Buffer> {
  const { classification: c, fund, portfolio_companies: companies, qualitative } = report;
  const amount = (m: Money | null): Cell => (m ? { value: m.value, format: AMOUNT } : "n/a");
  const multiple = (r: { value: number } | null): Cell => (r ? { value: r.value, format: MULTIPLE } : "n/a");
  const bold = (text: string): Cell => ({ text, bold: true });
  const title: Cell[][] = [
    [bold(c.gp_name)],
    [`${c.fund_name} - Capital Account Statement ${formatPeriodLabel(c.period_end)}`],
    [`As of ${formatLongDate(c.period_end)}. Amounts in ${c.currency}; multiples net of fees.`],
    [],
  ];

  const capitalAccount: Cell[][] = [
    ...title,
    [bold("Capital account"), bold(c.currency)],
    ["Total commitments", amount(fund.commitment)],
    ["Paid-in capital", amount(fund.paid_in)],
    ["Unfunded commitments", amount(fund.unfunded)],
    ["Cumulative distributions", amount(fund.distributions)],
    ["Net asset value", amount(fund.nav)],
    [],
    [bold("Performance (net)")],
    ["TVPI", multiple(fund.tvpi)],
    ["DPI", multiple(fund.dpi)],
    ["RVPI", multiple(fund.rvpi)],
    ["Net IRR", fund.net_irr ? { value: fund.net_irr.value, format: PERCENT } : "n/a"],
    [],
    [FOOTER_NOTE],
  ];

  const sum = (key: "invested" | "realized" | "unrealized" | "total_value") => companies.reduce((s, co) => s + (co[key]?.value ?? 0), 0);
  const portfolio: Cell[][] = [
    ...title,
    ["Company", "Country", "Sector", "Investment date", `Invested (${c.currency})`, `Realized (${c.currency})`,
      `Unrealized (${c.currency})`, `Total value (${c.currency})`, "Gross MOIC", `Revenue LTM (${c.currency})`,
      `EBITDA LTM (${c.currency})`, `Net debt (${c.currency})`].map(bold),
    ...companies.map((co): Cell[] => [
      co.name, co.country ?? "", co.sector ?? "", co.investment_date ? { date: co.investment_date } : "n/a",
      amount(co.invested), amount(co.realized), amount(co.unrealized), amount(co.total_value), multiple(co.gross_moic),
      amount(co.revenue_ltm), amount(co.ebitda_ltm), amount(co.net_debt),
    ]),
    [bold("Total"), "", "", "", { value: sum("invested"), format: AMOUNT, bold: true }, { value: sum("realized"), format: AMOUNT, bold: true },
      { value: sum("unrealized"), format: AMOUNT, bold: true }, { value: sum("total_value"), format: AMOUNT, bold: true }],
    [],
    [FOOTER_NOTE],
  ];

  const letter: Cell[][] = [
    ...title,
    ["Dear Limited Partners,"],
    [`Please find attached the capital account statement of ${c.fund_name} for ${formatPeriodLabel(c.period_end)}.`],
    [],
    [bold("Highlights of the quarter")],
    ...qualitative.key_updates.map((update) => [`- ${update}`]),
    [],
    ...(qualitative.outlook ? [[bold("Outlook")], [qualitative.outlook], []] : []),
    ["Kind regards,"],
    [`${c.gp_name} Investor Relations`],
    [],
    [FOOTER_NOTE],
  ];

  return writeWorkbook({
    title: `${c.fund_name} - Capital Account Statement ${formatPeriodLabel(c.period_end)}`, author: c.gp_name,
    created: new Date(Date.parse(c.period_end) + 45 * 86_400_000), // issued 45 days after quarter end, as the PDFs
    sheets: [
      { name: "Capital account", rows: capitalAccount, widths: [34, 18] },
      { name: "Portfolio", rows: portfolio, widths: [26, 9, 20, 15, 16, 16, 18, 18, 11, 18, 18, 16] },
      { name: "Letter to investors", rows: letter, widths: [120] },
    ],
  });
}
