// Deliberately flawed documents (SPEC-corpus "Traps"). Each trap returns the LABEL (what a careful reader should
// conclude) and the RENDER options (what the page actually shows), which differ on purpose.
import type { Extraction } from "../../core/schema.ts";
import type { GpProfile } from "./profiles.ts";
import type { RenderOptions } from "./render-pdf.ts";

export type Trap = "tvpi_misprint" | "chart_nav" | "restatement";

export type TrapResult = { label: Extraction; render: Extraction; options: RenderOptions; flags: string[] };

const round = (value: number, step: number) => Math.round(value / step) * step;

export function applyTrap(trap: Trap, report: Extraction, profile: GpProfile): TrapResult {
  const { tvpi, nav } = report.fund;
  switch (trap) {
    // The GP misprints TVPI. The label holds what is printed; only the TVPI identity can fail. Both reads should
    // agree on the wrong number, so step 7 sees "checks fail, reads agree": a source inconsistency, not a misread.
    case "tvpi_misprint": {
      if (!tvpi) throw new Error("tvpi_misprint needs a TVPI");
      const label = { ...report, fund: { ...report.fund, tvpi: { ...tvpi, value: Number((tvpi.value + 0.12).toFixed(2)) } } };
      return { label, render: label, options: {}, flags: ["tvpi_inconsistent"] };
    }
    // NAV appears only inside a chart image: invisible to the text layer, visible to a vision read.
    case "chart_nav": {
      if (!nav) throw new Error("chart_nav needs a NAV");
      const history = [0.82, 0.88, 0.94, 1].map((share) => round(nav.value * share, profile.roundTo));
      return { label: report, render: report, options: { navChart: { history } }, flags: [] };
    }
    // The NAV row carries a footnote: revised after the reporting date. The revised NAV is the right figure, but
    // the printed multiples still use the original, so the ratio identities fail. A reader that takes the table
    // value instead gets a wrong NAV that is consistent with the ratios, which no check can catch.
    case "restatement": {
      if (!nav) throw new Error("restatement needs a NAV");
      const revised = round(nav.value * 0.96, profile.roundTo);
      const company = report.portfolio_companies[0]?.name ?? "a portfolio company";
      return {
        label: { ...report, fund: { ...report.fund, nav: { ...nav, value: revised } } }, render: report,
        options: { navFootnote: { revisedValue: revised, company } }, flags: ["rvpi_inconsistent", "tvpi_inconsistent"],
      };
    }
  }
}
