// Step 6 (critic): re-reads the source for the fields involved in failed checks, at most two rounds. It may only
// confirm, correct (with the printed text AND a page) or report a figure missing; it never computes one. When the
// document itself is inconsistent, the right answer is "confirmed as printed": the flag must survive into step 7.
import type { LlmClient, LlmResponse } from "../llm.ts";
import { STEP_MODELS } from "./models.ts";
import { normalizeRaw, operatingRow } from "./normalize-step.ts";
import type { ExtractionStore } from "./normalize-step.ts";
import { scaleFromUnitStatement } from "./normalize.ts";
import {
  CRITIC_FIELDS_PROMPT, CRITIC_PORTFOLIO_PROMPT, criticFieldsInput, criticPortfolioInput, type FieldToCheck,
} from "./prompts/critic.ts";
import type { RawExtraction, RawValue } from "./prompts/extract.ts";
import type { Step } from "./run.ts";

export const MAX_CRITIC_ROUNDS = 2;

const FUND_LABELS: Record<string, string> = {
  commitment: "Total commitments", paid_in: "Paid-in capital", unfunded: "Unfunded commitments",
  distributions: "Cumulative distributions", nav: "Net asset value", tvpi: "TVPI", dpi: "DPI", rvpi: "RVPI", net_irr: "Net IRR",
};
// Company figures a check can name: portfolio-table figures, and operating metrics (EBITDA plausibility check), which
// live in their own table, joined to the company by name.
const PORTFOLIO_KEYS = ["invested", "realized", "unrealized", "total_value", "gross_moic"] as const;
const OPERATING_KEYS = ["revenue_ltm", "ebitda_ltm", "net_debt"] as const;

// Locates the raw (as printed) slot behind a schema path such as "fund.tvpi" or "portfolio_companies[2].net_debt".
export function slot(raw: RawExtraction, path: string): { label: string; get(): RawValue; set(v: RawValue): void } | null {
  const fund = /^fund\.(\w+)$/.exec(path);
  if (fund?.[1] && fund[1] in raw.fund) {
    const key = fund[1] as keyof RawExtraction["fund"];
    return { label: FUND_LABELS[key] ?? key, get: () => raw.fund[key], set: (v) => { raw.fund[key] = v; } };
  }
  const company = /^portfolio_companies\[(\d+)\]\.(\w+)$/.exec(path);
  const row = company ? raw.portfolio.companies[Number(company[1])] : undefined;
  const key = company?.[2];
  if (!row || !key) return null;
  if ((OPERATING_KEYS as readonly string[]).includes(key)) {
    const ops = operatingRow(raw, row.name);
    const k = key as (typeof OPERATING_KEYS)[number];
    return ops ? { label: `${row.name}: ${k.replaceAll("_", " ")}`, get: () => ops[k], set: (v) => { ops[k] = v; } } : null;
  }
  if (!(PORTFOLIO_KEYS as readonly string[]).includes(key)) return null;
  const k = key as (typeof PORTFOLIO_KEYS)[number];
  return { label: `${row.name}: ${k.replace("_", " ")}`, get: () => row[k], set: (v) => { row[k] = v; } };
}

export function criticStep(llm: LlmClient, store: ExtractionStore): Step {
  return {
    name: "critic",
    async run(ctx) {
      if (!ctx.raw || !ctx.classification || !ctx.parsed) throw new Error("nothing to check (extract and normalize must run first)");
      const classification = ctx.classification;
      const pages = ctx.parsed.pages;
      let raw: RawExtraction = structuredClone(ctx.raw);
      let state = { raw, extraction: ctx.extraction ?? null, checks: ctx.checks ?? [], issues: ctx.normalizationIssues ?? [] };
      const failing = () => state.checks.filter((c) => c.status === "fail");
      if (failing().length === 0) return { ctx, summary: { rounds: 0 } };

      const outcome = { corrected: [] as string[], confirmed: [] as string[], notFound: [] as string[], rejected: [] as string[] };
      const responses: LlmResponse<unknown>[] = [];
      const companiesBefore = raw.portfolio.companies.length;
      let portfolioReread = false;
      let rounds = 0;

      for (let round = 1; round <= MAX_CRITIC_ROUNDS && failing().length > 0; round++) {
        const failed = failing();
        let changed = false;

        // Missing companies have no field paths to re-read, so a NAV-bridge failure re-reads the whole table (once).
        if (!portfolioReread && failed.some((c) => c.id === "nav_bridge_gap")) {
          portfolioReread = true;
          const scale = scaleFromUnitStatement(classification.unit_statement);
          const sum = (state.extraction?.portfolio_companies ?? []).reduce((s, co) => s + (co.unrealized?.value ?? 0), 0);
          const response = await llm.complete({
            step: "critic", prompt: { id: CRITIC_PORTFOLIO_PROMPT.id, version: CRITIC_PORTFOLIO_PROMPT.version }, model: STEP_MODELS.critic,
            effort: CRITIC_PORTFOLIO_PROMPT.effort, system: CRITIC_PORTFOLIO_PROMPT.system, schema: CRITIC_PORTFOLIO_PROMPT.schema,
            text: criticPortfolioInput(pages, raw.portfolio.companies.length,
              String(Number((sum / (scale.ok ? scale.value : 1)).toFixed(1))), raw.fund.nav.raw ?? "not stated"),
          });
          responses.push(response);
          if (response.output.companies.length > raw.portfolio.companies.length) {
            raw = { ...raw, portfolio: response.output };
            changed = true;
          }
        }

        const paths = [...new Set(failed.filter((c) => c.id !== "nav_bridge_gap").flatMap((c) => c.failing ?? c.fields))];
        const fields: FieldToCheck[] = paths.flatMap((field) => {
          const s = slot(raw, field);
          return s ? [{ field, label: s.label, ...s.get() }] : [];
        });
        if (fields.length > 0) {
          const response = await llm.complete({
            step: "critic", prompt: { id: CRITIC_FIELDS_PROMPT.id, version: CRITIC_FIELDS_PROMPT.version }, model: STEP_MODELS.critic,
            effort: CRITIC_FIELDS_PROMPT.effort, system: CRITIC_FIELDS_PROMPT.system, schema: CRITIC_FIELDS_PROMPT.schema,
            text: criticFieldsInput(pages, failed.map((c) => c.message), fields),
          });
          responses.push(response);
          for (const verdict of response.output.fields) {
            const s = paths.includes(verdict.field) ? slot(raw, verdict.field) : null;
            if (!s) continue; // never touch a field that was not asked about
            if (verdict.verdict === "confirmed_as_printed") outcome.confirmed.push(verdict.field);
            else if (verdict.verdict === "not_found") outcome.notFound.push(verdict.field);
            else if (!verdict.raw || !verdict.page) outcome.rejected.push(verdict.field); // untraceable: not applied
            else if (verdict.raw !== s.get().raw || verdict.page !== s.get().page) {
              s.set({ raw: verdict.raw, page: verdict.page });
              outcome.corrected.push(verdict.field);
              changed = true;
            }
          }
        }

        rounds = round;
        state = normalizeRaw(raw, classification);
        raw = state.raw; // blank rows dropped: from here on, indexes match the extraction and its checks
        await store.append({ run_id: ctx.runId, round, raw, extraction: state.extraction, checks: state.checks });
        if (!changed) break; // everything confirmed or unchanged: another round would ask the same question
      }

      const unique = (xs: string[]) => [...new Set(xs)];
      return {
        ctx: { ...ctx, raw, extraction: state.extraction, checks: state.checks, normalizationIssues: state.issues, extractionRound: rounds || ctx.extractionRound },
        actor: `llm:${responses[0]?.usage.model ?? STEP_MODELS.critic}`,
        summary: {
          rounds, corrected: unique(outcome.corrected), confirmed: unique(outcome.confirmed), notFound: unique(outcome.notFound),
          rejected: unique(outcome.rejected), portfolioReread, companiesBefore, companiesAfter: raw.portfolio.companies.length,
          checksFailedAfter: failing().map((c) => c.id),
          costUsd: Math.round(responses.reduce((s, r) => s + r.usage.costUsd, 0) * 1e6) / 1e6,
          cached: responses.length > 0 && responses.every((r) => r.cached === true),
        },
      };
    },
  };
}
