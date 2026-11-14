// npm run corpus:verify - fails (exit 1) if any label is invalid, inconsistent or stale.
import path from "node:path";
import { verifyCorpus } from "./verify-corpus.ts";

const { issues, rows } = await verifyCorpus(path.resolve(import.meta.dirname, ".."));
console.table(rows.map(({ doc_id, split, format, scenario, route }) => ({ doc_id, split, format, scenario, route })));

// Coverage: how many documents per scenario and split, and per GP and format.
const count = (key: (r: (typeof rows)[number]) => string) =>
  Object.fromEntries([...Map.groupBy(rows, key)].map(([k, v]) => [k, { dev: v.filter((r) => r.split === "dev").length,
    heldout: v.filter((r) => r.split === "heldout").length }]));
console.log("\nTargeted step-7 outcome x split");
console.table(count((r) => r.targets));
console.log("GP x format");
console.table(count((r) => `${r.gp} · ${r.format}`));
if (issues.length > 0) {
  console.error(`\n${issues.length} issue(s):\n  ${issues.join("\n  ")}`);
  process.exit(1);
}
console.log(`\ncorpus ok: ${rows.length} documents`);
