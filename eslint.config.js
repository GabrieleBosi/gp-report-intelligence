import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", ".netlify", "corpus/docs"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // ADR-0003: the browser bundle must never reach Supabase or server-only code.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@supabase/*"], message: "Supabase is server-only (ADR-0003); call /api/* instead." },
          { group: ["**/netlify/**"], message: "netlify/ is server-only code (ADR-0003)." },
        ],
      }],
    },
  },
  {
    // Eval integrity: the pipeline may never read corpus metadata (GP, fund, period). Classification must come from
    // the document, or evals would measure leaked labels. The loader strips it too (forPipeline in core/documents.ts).
    files: ["core/pipeline/**/*.ts", "netlify/functions/run-*.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "Identifier[name='corpus_meta']", message: "The pipeline must not read corpus_meta (label leakage)." },
        { selector: "Literal[value='corpus_meta']", message: "The pipeline must not read corpus_meta (label leakage)." },
      ],
    },
  },
);
