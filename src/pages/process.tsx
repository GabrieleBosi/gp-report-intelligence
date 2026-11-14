import { Link } from "react-router";
import facts from "../generated/build-facts.json";
import { ARTIFACT_LOADERS } from "../showcase/artifacts.ts";
import { artifactGroups, hrefFor, labelFor, PROCESS_STEPS } from "../showcase/content.ts";
import type { BuildFacts } from "../showcase/facts.ts";

const f: BuildFacts = facts;
const groups = artifactGroups(Object.keys(ARTIFACT_LOADERS));
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const types = Object.entries(f.commits.byType).sort((a, b) => b[1] - a[1]);
const card = "rounded-lg border border-slate-200 bg-white p-4";

// Showcase process page (SPEC-showcase, page 3): the agent-skills flow, the build facts, and every artifact in the app.
export function ProcessPage() {
  return (
    <section aria-labelledby="process-heading" className="space-y-5">
      <div className="max-w-5xl space-y-1">
        <h2 id="process-heading" className="text-xl font-semibold text-slate-900">How it was built</h2>
        <p className="text-slate-700">
          Built with Claude Code following the agent-skills workflow: nothing was coded before its spec and plan were
          approved, every task started with a failing test, and every module ended with its success criteria checked on the
          live site. The human gates are where the product owner decided; the artifacts below are the record.
        </p>
      </div>

      <ol aria-label="The workflow" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {PROCESS_STEPS.map((s, i) => (
          <li key={s.name} className={`${card} flex flex-col p-3`}>
            <p className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">{i + 1}</span>
              {s.gate && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300">human gate</span>}
            </p>
            <h3 className="mt-1 font-semibold text-slate-900">{s.name}</h3>
            <p className="mt-1 flex-1 text-xs text-slate-700">{s.text}</p>
            <Link to={hrefFor(s.example)} className="mt-2 text-xs text-slate-600 underline underline-offset-2 hover:text-slate-900">{labelFor(s.example)}</Link>
          </li>
        ))}
      </ol>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Build facts</h3>
          <p className="text-xs text-slate-500">Generated {when(f.generated_at)} (Zurich) from git, the test runner, GitHub Actions and the LLM ledger · {f.pipeline} · {f.policy}</p>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          Commits and CI runs are the development history, kept in a private archive: this repository is a cleaned copy of
          it, published as one commit. Tests are counted in this repository.
        </p>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-slate-500">Commits</dt>
            <dd className="text-2xl font-semibold tabular-nums text-slate-900">{f.commits.total}</dd>
            <dd className="text-xs text-slate-600">per day: {Object.entries(f.commits.byDay).map(([d, n]) => `${day(d)} ${n}`).join(" · ")}</dd>
            <dd className="mt-1 text-xs text-slate-600">{types.map(([t, n]) => `${t} ${n}`).join(" · ")}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tests</dt>
            <dd className="text-2xl font-semibold tabular-nums text-slate-900">{f.tests.unit}</dd>
            <dd className="text-xs text-slate-600">unit and integration tests in {f.tests.unitFiles} files, plus {f.tests.e2e} browser tests and {f.tests.sqlContracts} database contract scripts</dd>
          </div>
          <div>
            <dt className="text-slate-500">CI runs</dt>
            <dd className="text-2xl font-semibold tabular-nums text-slate-900">{f.ci.runs}</dd>
            <dd className="text-xs text-slate-600">
              {f.ci.success} passed, {f.ci.failure} failed: {f.ci.failedProof} were the deliberate gate proof (a broken change
              must fail), {f.ci.failedMain} were real failures on main
              {f.ci.mainFixedWithinMinutes !== null && `, each fixed by a later push within ${f.ci.mainFixedWithinMinutes} minutes`}
              {f.ci.mainUnfixed > 0 && ` (${f.ci.mainUnfixed} not yet fixed)`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">LLM spend</dt>
            <dd className="text-2xl font-semibold tabular-nums text-slate-900">{f.llm ? `$${f.llm.costUsd.toFixed(2)}` : "—"}</dd>
            <dd className="text-xs text-slate-600">{f.llm ? `${f.llm.calls} model calls by the pipeline, evals and experiments, recorded in the budget ledger since ${when(f.llm.first ?? f.commits.first)}; not Claude Code's own usage` : "not available"}</dd>
          </div>
        </dl>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-slate-900">Every artifact, readable here</h3>
        <p className="text-xs text-slate-500">Every document and test in the repository, readable here; each opens in the app.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <h4 className="text-sm font-medium text-slate-900">{g.title} <span className="font-normal text-slate-500">({g.files.length})</span></h4>
              {g.title === "Tests" ? (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Show all {g.files.length} test files</summary>
                  <FileList files={g.files} />
                </details>
              ) : <FileList files={g.files} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FileList({ files }: { files: string[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {files.map((file) => (
        <li key={file}><Link to={`/docs/${file}`} className="break-all text-slate-700 underline underline-offset-2 hover:text-slate-900">{file}</Link></li>
      ))}
    </ul>
  );
}
