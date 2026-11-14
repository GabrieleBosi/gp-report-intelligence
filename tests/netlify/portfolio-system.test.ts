import { describe, expect, it } from "vitest";
import { PortfolioError } from "../../core/posting/post.ts";
import { toPortfolioError, toPostResult } from "../../netlify/lib/portfolio-system.ts";

describe("portfolio system adapter", () => {
  it("maps the mock system's answer to the port's result", () => {
    expect(toPostResult({ kind: "posted", record_id: "f:2025-09-30", version: 2, supersedes: 1 }))
      .toEqual({ kind: "posted", recordId: "f:2025-09-30", version: 2, supersedes: 1 });
    expect(toPostResult({ kind: "unchanged", record_id: "f:2025-09-30", version: 1, supersedes: null }))
      .toEqual({ kind: "unchanged", recordId: "f:2025-09-30", version: 1, supersedes: null });
  });

  it("treats a validation refusal (check_violation) as a rejection, anything else as an outage", () => {
    const rejected = toPortfolioError({ code: "23514", message: "unknown fund 0000" });
    const outage = toPortfolioError({ code: "57014", message: "canceling statement due to statement timeout" });

    expect(rejected).toBeInstanceOf(PortfolioError);
    expect([rejected.kind, rejected.message]).toEqual(["rejected", "unknown fund 0000"]);
    expect(outage.kind).toBe("unavailable");
  });
});
