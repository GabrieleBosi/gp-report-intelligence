import type { KnownFund } from "../../core/pipeline/classify.ts";

// Mirrors the known_funds seed in supabase/migrations/20261011061552_pipeline.sql.
export const KNOWN_FUNDS: KnownFund[] = [
  { id: "f-alpenrose", gp_name: "Alpenrose Capital", fund_name: "Alpenrose Buyout IV", aliases: ["Alpenrose IV"] },
  { id: "f-harbourline", gp_name: "Harbourline Partners", fund_name: "Harbourline Growth II", aliases: ["Harbourline II"] },
  { id: "f-nordkap", gp_name: "Nordkap Equity", fund_name: "Nordkap Mid-Market III", aliases: ["Nordkap MM III", "Nordkap III"] },
  { id: "f-meridian", gp_name: "Meridian Growth", fund_name: "Meridian Tech Opportunities I", aliases: ["Meridian TO I"] },
];
