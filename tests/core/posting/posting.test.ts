import { describe, expect, it } from "vitest";
import type { Extraction } from "../../../core/schema.ts";
import { buildRecord, type RecordInput } from "../../../core/posting/record.ts";
import { PortfolioError, postRun, type PostingAttempt, type PortfolioSystem, publicPostingError } from "../../../core/posting/post.ts";

const money = (millions: number, page = 1) => ({ value: millions * 1e6, currency: "USD", source: { page } });
const ratio = (value: number) => ({ value, source: { page: 1 } });
const extraction: Extraction = {
  classification: { gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30", report_type: "quarterly_report", currency: "USD" },
  fund: { commitment: money(750), paid_in: money(570.6), unfunded: money(179.4), distributions: money(82.6), nav: money(633.7),
    tvpi: ratio(1.38), dpi: ratio(0.14), rvpi: ratio(1.11), net_irr: ratio(0.04) },
  portfolio_companies: [], qualitative: { key_updates: [], outlook: null },
};
const input = (over: Partial<RecordInput> = {}): RecordInput => ({
  runId: "run-1", status: "approved", documentSha256: "d".repeat(64), pipelineVersion: "pipeline@0.11.1", knownFundId: "f-har",
  extraction, policy: "policy@2",
  decisions: [
    { kind: "field_corrected", field: "portfolio_companies[0].ebitda_ltm", before: { raw: "724" }, after: { raw: "72.4" }, analyst: "Gabriele", reason: null },
    { kind: "approved", field: null, before: null, after: null, analyst: "Gabriele", reason: "Posted as printed; GP asked to restate TVPI." },
  ],
  ...over,
});

describe("buildRecord", () => {
  it("posts the latest round with identity, figures and provenance, cleared by the analyst with the reason", async () => {
    const record = await buildRecord(input());

    expect(record.ok && record.value).toMatchObject({
      fund_id: "f-har", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", period_end: "2025-09-30", currency: "USD",
      fund: { nav: { value: 633_700_000 } },
      provenance: { run_id: "run-1", document_sha256: "d".repeat(64), pipeline_version: "pipeline@0.11.1", policy: "policy@2",
        cleared: { by: "analyst", analyst: "Gabriele", reason: "Posted as printed; GP asked to restate TVPI." },
        corrections: [{ field: "portfolio_companies[0].ebitda_ltm", before: "724", after: "72.4", analyst: "Gabriele" }] },
    });
    expect(record.ok && record.value.figures_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records an auto-post as cleared by the policy, and the same figures give the same hash", async () => {
    const auto = await buildRecord(input({ status: "ready_to_post", decisions: [] }));
    const again = await buildRecord(input({ status: "ready_to_post", decisions: [], runId: "run-2" }));

    expect(auto.ok && auto.value.provenance.cleared).toEqual({ by: "auto_post", policy: "policy@2" });
    expect(auto.ok && again.ok && auto.value.figures_hash === again.value.figures_hash).toBe(true);
  });

  it("refuses a record a portfolio system could not accept, naming what is missing", async () => {
    const result = await buildRecord(input({ knownFundId: null, extraction: { ...extraction, fund: { ...extraction.fund, nav: null } } }));

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_record", message: expect.stringMatching(/fund id.*nav/s) } });
  });
});

function fakes(behaviour: () => ReturnType<PortfolioSystem["post"]>) {
  const calls: string[] = [];
  const attempts: { attempt: PostingAttempt; setPosted: boolean }[] = [];
  return {
    calls, attempts,
    deps: {
      system: { async post(_record, key) { calls.push(key); return behaviour(); } } as PortfolioSystem,
      log: { async complete(_runId: string, attempt: PostingAttempt, setPosted: boolean) { attempts.push({ attempt, setPosted }); } },
    },
  };
}

describe("postRun", () => {
  it("posts a cleared run with the run id as idempotency key, logs the attempt and marks the run posted", async () => {
    const f = fakes(async () => ({ kind: "posted", recordId: "r-1", version: 2, supersedes: 1 }));

    const outcome = await postRun(f.deps, input());

    expect(outcome).toEqual({ ok: true, value: { kind: "posted", recordId: "r-1", version: 2, supersedes: 1 } });
    expect(f.calls).toEqual(["run-1"]);
    expect(f.attempts).toEqual([{ setPosted: true, attempt: expect.objectContaining({ outcome: "posted", record_id: "r-1", version: 2, error: null }) }]);
  });

  it.each([["unchanged"], ["duplicate"]] as const)("treats %s as posted (the system already holds these figures)", async (kind) => {
    const f = fakes(async () => ({ kind, recordId: "r-1", version: 1, supersedes: null }));

    expect((await postRun(f.deps, input())).ok).toBe(true);
    expect(f.attempts[0]).toMatchObject({ setPosted: true, attempt: { outcome: kind === "unchanged" ? "unchanged" : "posted" } });
  });

  it("answers a retry of an already posted run with the original record (idempotent), without logging a new posting", async () => {
    const f = fakes(async () => ({ kind: "duplicate", recordId: "r-1", version: 1, supersedes: null }));

    expect(await postRun(f.deps, input({ status: "posted" }))).toEqual({ ok: true, value: { kind: "duplicate", recordId: "r-1", version: 1, supersedes: null } });
    expect(f.calls).toEqual(["run-1"]);
    expect(f.attempts).toEqual([]);
  });

  it.each([["needs_review"], ["needs_triage"], ["rejected"], ["running"]])("never posts a %s run, and never calls the system", async (status) => {
    const f = fakes(async () => ({ kind: "posted", recordId: "r", version: 1, supersedes: null }));

    expect(await postRun(f.deps, input({ status }))).toMatchObject({ ok: false, error: { code: "not_cleared",
      message: expect.stringMatching(/^This run is .+: only runs ready to post or approved by an analyst can be posted\.$/) } });
    expect(f.calls).toEqual([]);
    expect(f.attempts).toEqual([]);
  });

  it("keeps the status and logs the failure when the system is down", async () => {
    const f = fakes(async () => { throw new PortfolioError("unavailable", "portfolio system timed out"); });

    // the raw text goes back to the server (function log); the posting log, shown on the run page, gets the public wording
    expect(await postRun(f.deps, input())).toMatchObject({ ok: false, error: { code: "unavailable", message: "portfolio system timed out" } });
    expect(f.attempts).toEqual([{ setPosted: false, attempt: expect.objectContaining({ outcome: "failed",
      error: "The portfolio system is not reachable right now. Please retry the posting." }) }]);
  });

  it("logs a rejection by the system (422) as rejected, not as a failure to retry", async () => {
    const f = fakes(async () => { throw new PortfolioError("rejected", "unknown fund id"); });

    expect(await postRun(f.deps, input())).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(f.attempts[0]).toMatchObject({ setPosted: false, attempt: { outcome: "rejected",
      error: "The portfolio system refused the record: it failed validation. The details are in the function log." } });
  });

  it("logs an invalid record as rejected without calling the system", async () => {
    const f = fakes(async () => ({ kind: "posted", recordId: "r", version: 1, supersedes: null }));

    expect(await postRun(f.deps, input({ knownFundId: null }))).toMatchObject({ ok: false, error: { code: "invalid_record" } });
    expect(f.calls).toEqual([]);
    expect(f.attempts[0]).toMatchObject({ setPosted: false, attempt: { outcome: "rejected" } });
  });
});

describe("publicPostingError (security audit 2026-10-11, finding 4)", () => {
  it("never shows the database's own wording for a refusal or an outage; our own messages pass unchanged", () => {
    expect(publicPostingError("unavailable", "connect ECONNREFUSED 10.0.0.1:5432")).toBe("The portfolio system is not reachable right now. Please retry the posting.");
    expect(publicPostingError("rejected", 'new row for relation "portfolio_records" violates check constraint "x"'))
      .toBe("The portfolio system refused the record: it failed validation. The details are in the function log.");
    expect(publicPostingError("not_cleared", "This run is needs review: only runs ready to post or approved can be posted."))
      .toBe("This run is needs review: only runs ready to post or approved can be posted.");
  });
});
