import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../../core/hash.ts";
import { LlmError } from "../../../core/llm.ts";
import { loadStep, type DocumentLoader } from "../../../core/pipeline/load.ts";
import { executeRun, type RunAuditEvent, type RunStore, type Step } from "../../../core/pipeline/run.ts";
import { fundFieldRows, routeBanner, toRunView, type AssessmentView } from "../../../core/pipeline/run-view.ts";

class FakeRunStore implements RunStore {
  audit: RunAuditEvent[] = [];
  finished: { status: string; error?: string } | null = null;
  private readonly claimable: boolean;
  constructor(claimable: boolean) { this.claimable = claimable; }
  async claim() { return this.claimable ? { documentId: "doc-1" } : null; }
  async finish(_: string, outcome: { status: "extracted" } | { status: "failed"; error: string }) { this.finished = outcome; }
  async appendAudit(event: RunAuditEvent) { this.audit.push(event); }
}

function tickingClock(stepMs = 25) {
  let t = 0;
  return () => (t += stepMs);
}

const step = (name: Step["name"], effect: () => Promise<unknown> = async () => undefined): Step => ({
  name,
  async run(ctx) { await effect(); return { ctx, summary: { ran: name } }; },
});

describe("executeRun", () => {
  it("does nothing when the run cannot be claimed (already started or finished)", async () => {
    const store = new FakeRunStore(false);
    let ran = false;

    const outcome = await executeRun("run-1", [step("load", async () => { ran = true; })], store);

    expect(outcome).toBe("not_claimed");
    expect(ran).toBe(false);
    expect(store.audit).toEqual([]);
  });

  it("runs the steps in order and audits each with its sketch step number, duration and summary", async () => {
    const store = new FakeRunStore(true);

    const outcome = await executeRun("run-1", [step("load"), step("classify")], store, tickingClock());

    expect(outcome).toBe("extracted");
    expect(store.audit).toEqual([
      { run_id: "run-1", step: 1, actor: "system", event: "load.completed", payload: { durationMs: 25, ran: "load" } },
      { run_id: "run-1", step: 2, actor: "system", event: "classify.completed", payload: { durationMs: 25, ran: "classify" } },
    ]);
    expect(store.finished).toEqual({ status: "extracted" });
  });

  it("stops at the first failing step and records the reason on the run", async () => {
    const store = new FakeRunStore(true);
    let laterStepRan = false;

    const outcome = await executeRun("run-1", [
      step("load", async () => { throw new Error("storage unavailable"); }),
      step("classify", async () => { laterStepRan = true; }),
    ], store, tickingClock());

    expect(outcome).toBe("failed");
    expect(laterStepRan).toBe(false);
    expect(store.audit).toEqual([
      { run_id: "run-1", step: 1, actor: "system", event: "load.failed", payload: { durationMs: 25, error: "storage unavailable" } },
    ]);
    expect(store.finished).toEqual({ status: "failed", error: "load: storage unavailable" });
  });

  it("passes a budget refusal through as the user-facing reason", async () => {
    const store = new FakeRunStore(true);

    await executeRun("run-1", [step("classify", async () => {
      throw new LlmError("budget_exceeded", "Daily LLM budget of $15.00 reached ($15.02 spent today). Try again tomorrow.");
    })], store);

    expect(store.finished?.error).toBe("classify: Daily LLM budget of $15.00 reached ($15.02 spent today). Try again tomorrow.");
  });

  it("finishes with the status the last step decided, when one did", async () => {
    const store = new FakeRunStore(true);
    const decide: Step = { name: "confidence", async run(ctx) { return { ctx: { ...ctx, finalStatus: "needs_review" } }; } };

    const outcome = await executeRun("run-1", [decide], store);

    expect(outcome).toBe("needs_review");
    expect(store.finished).toEqual({ status: "needs_review" });
  });

  it("caps a very long error message", async () => {
    const store = new FakeRunStore(true);

    await executeRun("run-1", [step("load", async () => { throw new Error("x".repeat(5_000)); })], store);

    expect(store.finished?.error?.length).toBeLessThanOrEqual(500);
  });
});

describe("loadStep", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 report");
  const loader = (sha256: string): DocumentLoader => ({
    async load(id) {
      return {
        document: { id, sha256, filename: "r.pdf", mime: "application/pdf", size_bytes: bytes.byteLength, storage_path: "x",
          source: "upload", corpus_meta: null, created_at: "2026-10-11T00:00:00Z" },
        bytes,
      };
    },
  });

  it("loads the document into the run context and summarizes it", async () => {
    const outcome = await loadStep(loader(await sha256Hex(bytes))).run({ runId: "run-1", documentId: "doc-1" });

    expect(outcome.ctx.loaded?.bytes).toBe(bytes);
    expect(outcome.summary).toEqual({ filename: "r.pdf", mime: "application/pdf", size_bytes: bytes.byteLength });
  });

  it("refuses a file whose bytes no longer match the hash recorded when it was received", async () => {
    await expect(loadStep(loader("0".repeat(64))).run({ runId: "run-1", documentId: "doc-1" })).rejects.toThrow(/integrity/);
  });
});

describe("toRunView", () => {
  it("turns audit events into a step timeline, ignoring events that are not step outcomes", () => {
    const view = toRunView(
      { id: "run-1", document_id: "doc-1", status: "failed", pipeline_version: "pipeline@0.1.0", error: "classify: boom",
        created_at: "2026-10-11T08:00:00Z", started_at: "2026-10-11T08:00:01Z", finished_at: "2026-10-11T08:00:05Z" },
      { filename: "r.pdf" },
      null,
      null,
      [
        { step: 1, actor: "system", event: "received", payload: {}, created_at: "2026-10-11T07:00:00Z" },
        { step: 1, actor: "system", event: "load.completed", payload: { durationMs: 40, filename: "r.pdf" }, created_at: "2026-10-11T08:00:02Z" },
        { step: 2, actor: "llm:claude-opus-5-5", event: "classify.failed", payload: { durationMs: 900, error: "boom" }, created_at: "2026-10-11T08:00:05Z" },
      ],
    );

    expect(view.steps).toEqual([
      { name: "load", sketchStep: 1, outcome: "completed", actor: "system", durationMs: 40, at: "2026-10-11T08:00:02Z", details: { filename: "r.pdf" } },
      { name: "classify", sketchStep: 2, outcome: "failed", actor: "llm:claude-opus-5-5", durationMs: 900, at: "2026-10-11T08:00:05Z", details: { error: "boom" } },
    ]);
    expect(view.run.status).toBe("failed");
    expect(view.document.filename).toBe("r.pdf");
  });
});

describe("fundFieldRows", () => {
  const v = (raw: string, page = 1) => ({ raw, page });
  const raw = {
    readMode: "text" as const,
    fund: { commitment: v("500.0"), paid_in: v("330.5"), unfunded: v("169.5"), distributions: v("60.0"), nav: v("420.8"),
      tvpi: v("1.52x"), dpi: v("0.18x"), rvpi: v("1.27x"), net_irr: { raw: null, page: null } },
    portfolio: { companies: [] }, operating: { companies: [] }, qualitative: { key_updates: [], outlook: null },
  };
  const money = (value: number) => ({ value, currency: "EUR", source: { page: 1 } });
  const ratio = (value: number) => ({ value, source: { page: 1 } });
  const extraction = {
    classification: { gp_name: "A", fund_name: "F", period_end: "2026-06-30", report_type: "quarterly_report" as const, currency: "EUR" },
    fund: { commitment: money(500e6), paid_in: money(330.5e6), unfunded: money(169.5e6), distributions: money(60e6), nav: money(420.8e6),
      tvpi: ratio(1.52), dpi: ratio(0.18), rvpi: ratio(1.27), net_irr: null },
    portfolio_companies: [], qualitative: { key_updates: [], outlook: null },
  };
  const checks = [
    { id: "tvpi_inconsistent" as const, status: "fail" as const, message: "TVPI printed 1.52 but figures imply 1.450", fields: ["fund.tvpi", "fund.distributions", "fund.nav", "fund.paid_in"] },
    { id: "dpi_inconsistent" as const, status: "pass" as const, message: "ok", fields: ["fund.dpi", "fund.distributions", "fund.paid_in"] },
  ];

  it("pairs every fund figure with its label, value, printed text, page and the failed checks that involve it", () => {
    const rows = fundFieldRows({ round: 0, raw, extraction, checks });

    expect(rows.map((r) => r.label)).toEqual(["Total commitments", "Paid-in capital", "Unfunded commitments", "Cumulative distributions",
      "Net asset value", "TVPI", "DPI", "RVPI", "Net IRR"]);
    expect(rows.find((r) => r.key === "nav")).toEqual({ key: "nav", label: "Net asset value", value: money(420.8e6), raw: "420.8", page: 1,
      read: "text", failedChecks: ["TVPI printed 1.52 but figures imply 1.450"] });
    expect(rows.find((r) => r.key === "dpi")?.failedChecks).toEqual([]);
    expect(rows.find((r) => r.key === "net_irr")).toMatchObject({ value: null, raw: null, page: null });
  });

  it("marks a figure filled by the vision fallback as read from the page image", () => {
    const rows = fundFieldRows({ round: 0, raw: { ...raw, visionFields: ["fund.nav"] }, extraction, checks });

    expect(rows.find((r) => r.key === "nav")?.read).toBe("vision");
    expect(rows.find((r) => r.key === "tvpi")?.read).toBe("text");
  });
});

describe("routeBanner", () => {
  const assessment = (route: AssessmentView["route"], reasons: string[] = [], levels: ("high" | "medium" | "low")[] = ["high"]): AssessmentView => ({
    round: 0, route, level: levels.includes("low") ? "low" : levels.includes("medium") ? "medium" : "high", policy: "policy@2", reasons,
    fields: levels.map((level, i) => ({ path: `fund.f${i}`, label: `F${i}`, valueA: 1, rawA: "1", valueB: 1, rawB: "1",
      checks: "pass", reads: "agree", flags: [], level, reason: "r" })),
  });

  it("says a clean document is ready to post, and why", () => {
    expect(routeBanner(assessment("auto_post"))).toEqual({
      tone: "positive", title: "Ready to post",
      detail: "Every key figure passed its checks and an independent image read agrees. Policy policy@2.",
    });
  });

  it("counts the key figures an analyst must look at", () => {
    const banner = routeBanner(assessment("review", ["TVPI: ...", "NAV: ..."], ["high", "low", "medium"]));

    expect(banner).toMatchObject({ tone: "warning", title: "Needs review" });
    expect(banner.detail).toMatch(/2 of 3 key figures/);
  });

  it("explains a triage", () => {
    expect(routeBanner(assessment("triage", ["Tessera Seed Fund I is not in the registry of known funds: unknown GP or layout."])))
      .toMatchObject({ tone: "neutral", title: "Needs triage", detail: expect.stringMatching(/not in the registry/) });
  });
});
