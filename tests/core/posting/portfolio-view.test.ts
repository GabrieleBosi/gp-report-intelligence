import { describe, expect, it } from "vitest";
import { groupKey, groupRecords, visibleVersions, type PortfolioRow } from "../../../core/posting/portfolio-view.ts";

const row = (over: Partial<PortfolioRow>): PortfolioRow => ({
  fund_id: "f1", fund_name: "Alpenrose Buyout IV", gp_name: "Alpenrose Capital", period_end: "2026-03-31", version: 1,
  posted_at: "2026-10-11T12:00:00Z", source_run: "run-1", nav: 414_100_000, tvpi: 1.44, dpi: 0.18, currency: "EUR",
  cleared: { by: "auto_post", policy: "policy@2" }, ...over,
});

describe("groupRecords", () => {
  it("groups versions by fund and period, newest version current, older ones superseded, records newest first", () => {
    const records = groupRecords([
      row({ version: 1, source_run: "run-1", nav: 400_000_000 }),
      row({ fund_id: "f2", fund_name: "Harbourline Growth II", period_end: "2025-09-30", posted_at: "2026-10-11T13:00:00Z", source_run: "run-9" }),
      row({ version: 2, source_run: "run-2", posted_at: "2026-10-11T14:00:00Z", nav: 414_100_000 }),
    ]);

    expect(records.map((r) => [r.fund_name, r.period_end, r.current.version, r.history.map((h) => [h.version, h.superseded])])).toEqual([
      ["Alpenrose Buyout IV", "2026-03-31", 2, [[2, false], [1, true]]],
      ["Harbourline Growth II", "2025-09-30", 1, [[1, false]]],
    ]);
    expect(records[0]?.current.nav).toBe(414_100_000);
  });
});

describe("folding a record's earlier versions (ship review 2026-10-12)", () => {
  const groups = groupRecords([
    row({ fund_id: "f-1", period_end: "2025-09-30", version: 1 }), row({ fund_id: "f-1", period_end: "2025-09-30", version: 2 }),
    row({ fund_id: "f-1", period_end: "2025-09-29", version: 1 }), // same fund and quarter, another date: its own record
  ]);

  it("keys each record by fund and full period end, so two records in one quarter never share a toggle", () => {
    expect(groups.map(groupKey).sort()).toEqual(["Alpenrose Buyout IV:2025-09-29", "Alpenrose Buyout IV:2025-09-30"]);
  });

  it("shows the current version only, and every version once the record is unfolded", () => {
    const record = groups.find((g) => g.period_end === "2025-09-30");
    if (!record) throw new Error("record missing");
    expect(visibleVersions(record, new Set()).map((r) => r.version)).toEqual([2]);
    expect(visibleVersions(record, new Set([groupKey(record)])).map((r) => r.version)).toEqual([2, 1]);
  });
});
