// The CI eval gate (SPEC-evals decision 2): no unsafe auto-post, ever; the gated accuracies never below the committed
// baseline. All-figure accuracy is reported, not gated.
import type { Summary } from "./metrics.ts";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const GATED: [keyof Summary, string][] = [
  ["keyFigureAccuracy", "key-figure accuracy"], ["classificationAccuracy", "classification accuracy"], ["routeAccuracy", "route accuracy"],
];

export function checkGate(current: Summary, baseline: Summary): { pass: boolean; failures: string[] } {
  const failures = [
    ...(current.unsafe > 0 ? [`${current.unsafe} unsafe auto-post${current.unsafe > 1 ? "s" : ""} (must be 0)`] : []),
    ...GATED.filter(([k]) => current[k] < baseline[k] - 1e-9).map(([k, name]) => `${name} ${pct(current[k])} < baseline ${pct(baseline[k])}`),
  ];
  return { pass: failures.length === 0, failures };
}
