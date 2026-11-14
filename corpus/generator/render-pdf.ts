// Renders the standard quarterly report: fund overview + narrative, portfolio, operating metrics. Each section starts
// on the page given by profile.layout, because labels cite those pages as sources.
import PDFDocument from "pdfkit";
import type { Extraction, Money } from "../../core/schema.ts";
import { formatAmount, formatLongDate, formatPercent, formatPeriodLabel, formatRatio } from "./format.ts";
import type { GpProfile } from "./profiles.ts";
import { DEFAULT_VOCABULARY } from "./vocabulary.ts";

const MARGIN = 50;
const PORTRAIT_CONTENT_WIDTH = 595.28 - 2 * MARGIN; // A4 portrait; table column widths below are designed for it
const GREY = "#555555";
const RULE = "#bbbbbb";
const FOOTER_NOTE = "Fictional fund - synthetic data generated for a case-study prototype; not a real report";

type Column = { header: string; width: number; align?: "left" | "right" };

// Trap variations (corpus/generator/traps.ts).
export type RenderOptions = {
  navChart?: { history: number[] }; // NAV shown only as a bar chart image (no NAV text on the page)
  navFootnote?: { revisedValue: number; company: string }; // NAV row footnoted with a post-period revision
};

export async function renderStandardReport(report: Extraction, profile: GpProfile, options: RenderOptions = {}): Promise<Buffer> {
  const chart = options.navChart ? await renderNavChart(options.navChart.history, report.classification.period_end, profile) : null;
  const { classification: c, fund, portfolio_companies: companies, qualitative } = report;
  const period = formatPeriodLabel(c.period_end);
  const amount = (m: Money | null) => (m ? formatAmount(m.value, profile.style) : "n/a");
  const words = { ...DEFAULT_VOCABULARY, ...profile.vocabulary };
  const ratio = (value: number) => formatRatio(value, profile.style.decimal);
  const percent = (value: number) => formatPercent(value, 1, profile.style.decimal);

  const doc = new PDFDocument({
    size: "A4", layout: profile.orientation ?? "portrait", margin: MARGIN, bufferPages: true,
    // A fixed date (report issued 45 days after quarter end) keeps the output byte-deterministic.
    info: {
      Title: `${c.fund_name} - ${words.titleSuffix} ${period}`, Author: c.gp_name,
      CreationDate: new Date(Date.parse(c.period_end) + 45 * 86_400_000),
    },
  });
  const done = collect(doc);
  const contentWidth = doc.page.width - 2 * MARGIN;
  const startPage = (page: number) => {
    if (doc.bufferedPageRange().count < page) doc.addPage();
    else doc.moveDown(1.5); // section shares the page with the previous one (e.g. Tessera's one-page overview)
  };
  const widen = contentWidth / PORTRAIT_CONTENT_WIDTH; // landscape tables use the extra width

  // Page 1: fund overview, performance, narrative.
  doc.font("Helvetica-Bold").fontSize(18).text(c.gp_name);
  doc.font("Helvetica").fontSize(12).text(`${c.fund_name} - ${words.titleSuffix} ${period}`);
  doc.fontSize(9).fillColor(GREY)
    .text(words.reportingLine(formatLongDate(c.period_end), profile.style.unitLabel))
    .fillColor("black").moveDown(1.5);

  heading(doc, words.fundHeading);
  keyValues(doc, [
    [words.commitment, amount(fund.commitment)],
    [words.paidIn, amount(fund.paid_in)],
    [words.unfunded, amount(fund.unfunded)],
    [words.distributions, amount(fund.distributions)],
    ...(chart ? [] : [[words.nav, options.navFootnote ? `${amount(fund.nav)}\u00b9` : amount(fund.nav)] as [string, string]]),
  ]);
  if (chart) {
    heading(doc, `${words.nav} (${profile.style.unitLabel})`);
    doc.image(chart, MARGIN, doc.y, { width: 300 });
    doc.y += 150 + 12;
    doc.x = MARGIN;
  }
  heading(doc, words.performanceHeading);
  keyValues(doc, [
    [words.tvpi, fund.tvpi ? ratio(fund.tvpi.value) : "n/a"],
    [words.dpi, fund.dpi ? ratio(fund.dpi.value) : "n/a"],
    [words.rvpi, fund.rvpi ? ratio(fund.rvpi.value) : "n/a"],
    [words.irr, fund.net_irr ? percent(fund.net_irr.value) : "n/a"],
  ]);
  heading(doc, words.updatesHeading);
  doc.font("Helvetica").fontSize(10).list(qualitative.key_updates, { bulletRadius: 1.5, textIndent: 10 }).moveDown();
  if (qualitative.outlook) {
    heading(doc, words.outlookHeading);
    doc.font("Helvetica").fontSize(10).text(qualitative.outlook, { width: contentWidth });
  }
  if (options.navFootnote) {
    doc.moveDown().font("Helvetica").fontSize(8).fillColor(GREY).text(
      `\u00b9 Restated after the reporting date: following the final valuation of ${options.navFootnote.company}, the net asset value as of ` +
      `${formatLongDate(c.period_end)} is revised to ${formatAmount(options.navFootnote.revisedValue, profile.style)} ${profile.style.unitLabel}. ` +
      "The multiples above are based on the originally reported value.", { width: contentWidth },
    ).fillColor("black");
  }

  startPage(profile.layout.companies);
  heading(doc, words.portfolioHeading(profile.style.unitLabel));
  const sum = (key: "invested" | "realized" | "unrealized" | "total_value") =>
    companies.reduce((s, co) => s + (co[key]?.value ?? 0), 0);
  const totals = { invested: sum("invested"), realized: sum("realized"), unrealized: sum("unrealized"), total: sum("total_value") };
  const [h0, h1, h2, h3, h4, h5, h6, h7] = words.portfolioColumns;
  table(doc,
    [
      { header: h0, width: 113 }, { header: h1, width: 28 }, { header: h2, width: 85 },
      { header: h3, width: 50, align: "right" }, { header: h4, width: 50, align: "right" },
      { header: h5, width: 55, align: "right" }, { header: h6, width: 55, align: "right" },
      { header: h7, width: 59, align: "right" },
    ].map((col) => ({ ...col, width: col.width * widen })) as Column[],
    [
      ...companies.map((co) => [co.name, co.country ?? "", co.sector ?? "", amount(co.invested), amount(co.realized),
        amount(co.unrealized), amount(co.total_value), co.gross_moic ? ratio(co.gross_moic.value) : "n/a"]),
      [words.totalRow, "", "", formatAmount(totals.invested, profile.style), formatAmount(totals.realized, profile.style),
        formatAmount(totals.unrealized, profile.style), formatAmount(totals.total, profile.style),
        totals.invested ? ratio(Number((totals.total / totals.invested).toFixed(2))) : "n/a"],
    ],
    { boldLastRow: true });

  startPage(profile.layout.operating);
  heading(doc, words.operatingHeading(profile.style.unitLabel));
  table(doc,
    [
      { header: "Company", width: 140 }, { header: "Revenue", width: 65, align: "right" },
      { header: "EBITDA", width: 60, align: "right" }, { header: "EBITDA margin", width: 72, align: "right" },
      { header: "Net debt", width: 63, align: "right" }, { header: "Net debt / EBITDA", width: 95, align: "right" },
    ].map((col) => ({ ...col, width: col.width * widen })) as Column[],
    companies.map((co) => {
      const revenue = co.revenue_ltm?.value ?? 0;
      const ebitda = co.ebitda_ltm?.value ?? 0;
      return [co.name, amount(co.revenue_ltm), amount(co.ebitda_ltm), revenue ? percent(ebitda / revenue) : "n.m.",
        amount(co.net_debt), ebitda > 0 ? ratio((co.net_debt?.value ?? 0) / ebitda) : "n.m."];
    }));

  footers(doc, c.gp_name);
  doc.end();
  return done;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function heading(doc: PDFKit.PDFDocument, text: string): void {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("black").text(text, MARGIN).moveDown(0.4);
}

function keyValues(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
  doc.fontSize(10);
  for (const [key, value] of rows) {
    const y = doc.y;
    doc.font("Helvetica").text(key, MARGIN, y, { width: 220, lineBreak: false });
    doc.font("Helvetica-Bold").text(value, MARGIN + 220, y, { width: 90, align: "right", lineBreak: false });
    doc.y = y + 16;
  }
  doc.x = MARGIN;
  doc.moveDown(0.8);
}

function table(doc: PDFKit.PDFDocument, columns: Column[], rows: string[][], opts: { boldLastRow?: boolean } = {}): void {
  const rowHeight = 16;
  const drawRow = (cells: string[], font: string) => {
    const y = doc.y;
    let x = MARGIN;
    doc.font(font).fontSize(8.5);
    columns.forEach((col, i) => {
      const cell = cells[i] ?? "";
      // A cell wider than its column wraps onto the next row; fail generation instead of shipping overlapping text.
      if (doc.widthOfString(cell) > col.width - 4) throw new Error(`"${cell}" does not fit column "${col.header}"`);
      doc.text(cell, x, y, { width: col.width - 4, align: col.align ?? "left", lineBreak: false });
      x += col.width;
    });
    doc.y = y + rowHeight;
  };
  const rule = () => {
    doc.moveTo(MARGIN, doc.y - 4).lineTo(doc.page.width - MARGIN, doc.y - 4).strokeColor(RULE).lineWidth(0.5).stroke();
  };

  drawRow(columns.map((c) => c.header), "Helvetica-Bold");
  rule();
  rows.forEach((cells, i) => {
    const last = i === rows.length - 1;
    if (last && opts.boldLastRow) rule();
    drawRow(cells, last && opts.boldLastRow ? "Helvetica-Bold" : "Helvetica");
  });
  doc.x = MARGIN;
  doc.moveDown();
}

function footers(doc: PDFKit.PDFDocument, gpName: string): void {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would make pdfkit add a page, so lift the margin while drawing the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
      .text(`${gpName} - ${FOOTER_NOTE} - Page ${i + 1} of ${count}`, MARGIN, doc.page.height - 35,
        { width: doc.page.width - 2 * MARGIN, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

// A small bar chart of NAV by quarter, rendered to an image: the values live in pixels, not in the text layer.
async function renderNavChart(history: number[], periodEnd: string, profile: GpProfile): Promise<Buffer> {
  const { renderPageToPng } = await import("../../netlify/lib/pdf.ts");
  const [year, month] = periodEnd.split("-").map(Number);
  const quarters = history.map((_, i) => {
    const q = Math.ceil((month ?? 3) / 3) - (history.length - 1 - i);
    const shift = Math.floor((q - 1) / 4);
    return `Q${((q - 1) % 4 + 4) % 4 + 1} ${(year ?? 2025) + shift}`;
  });
  const width = 300;
  const height = 150;
  const chart = new PDFDocument({ size: [width, height], margin: 0, info: { CreationDate: new Date(Date.parse(periodEnd)) } });
  const done = collect(chart);
  const max = Math.max(...history);
  const barWidth = 44;
  history.forEach((value, i) => {
    const barHeight = (value / max) * 95;
    const x = 22 + i * 70;
    const y = 120 - barHeight;
    chart.rect(x, y, barWidth, barHeight).fill(i === history.length - 1 ? "#1f3a5f" : "#9fb3c8");
    chart.fillColor("black").font(i === history.length - 1 ? "Helvetica-Bold" : "Helvetica").fontSize(9)
      .text(formatAmount(value, profile.style), x - 8, y - 13, { width: barWidth + 16, align: "center", lineBreak: false });
    chart.font("Helvetica").fontSize(8).fillColor(GREY)
      .text(quarters[i] ?? "", x - 8, 126, { width: barWidth + 16, align: "center", lineBreak: false });
  });
  chart.end();
  return renderPageToPng(new Uint8Array(await done), 1, 200);
}
