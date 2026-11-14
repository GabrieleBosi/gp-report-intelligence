// The repository's own documents and tests, rendered in the app (SPEC-showcase). Each file is its own lazy chunk, loaded
// when opened. The globs must match ARTIFACT_GLOBS in content.ts (checked by tests/src/showcase-artifacts.test.ts).
const loaders = import.meta.glob<string>([
  "../../CAPABILITY-MAP.md", "../../SPEC-*.md", "../../tasks/*.md", "../../docs/**/*.md", "../../evals/reports/*.md",
  "../../evals/shadow/*.md", "../../evals/candidates/*.md", "../../tests/**/*.test.ts", "../../supabase/tests/*.sql",
  "../../e2e/*.spec.ts",
], { query: "?raw", import: "default" });

export const ARTIFACT_LOADERS: Record<string, () => Promise<string>> =
  Object.fromEntries(Object.entries(loaders).map(([k, load]) => [k.replace(/^(\.\.\/)+/, ""), load]));
