import { Link } from "react-router";
import { Markdown } from "../components/markdown.tsx";
import { hrefFor, labelFor, REQUIREMENTS, slug } from "../showcase/content.ts";
import { decisionGroups } from "../showcase/decisions.ts";
import { renderMarkdown } from "../showcase/markdown.ts";
import { SPEC_SOURCES } from "../showcase/sources.ts";

const groups = decisionGroups(SPEC_SOURCES);
const total = groups.reduce((n, g) => n + g.decisions.length, 0);
const title = (module: string) => module.charAt(0).toUpperCase() + module.slice(1);
const inline = (md: string, file: string) => renderMarkdown(md, file, { inline: true });
const prose = "[&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.9em]";

// Showcase decisions page (SPEC-showcase, page 4): requirement → choice, and every product-owner decision from the specs.
export function DecisionsPage() {
  return (
    <section aria-labelledby="decisions-heading" className="space-y-5">
      <div className="max-w-5xl space-y-1">
        <h2 id="decisions-heading" className="text-xl font-semibold text-slate-900">Decisions</h2>
        <p className="text-slate-700">
          Every spec went through a human gate: the product owner approved it, answered its open questions and decided its
          trade-offs. The {total} decisions below are read from the specs themselves, so this page cannot drift from them.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Business requirement → technical choice</h3>
        <div className="relative mt-2 overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Business requirements and technical choices">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th scope="col" className="px-3 py-2 font-medium">Requirement</th><th scope="col" className="px-3 py-2 font-medium">Technical choice</th><th scope="col" className="px-3 py-2 font-medium">Evidence</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {REQUIREMENTS.map((r) => (
                <tr key={r.need}>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.need}</td>
                  <td className="px-3 py-2 text-slate-700">{r.choice}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    <ul className="space-y-0.5">{r.evidence.map((e) => <li key={hrefFor(e)}><Link to={hrefFor(e)} className="underline underline-offset-2 hover:text-slate-900">{labelFor(e)}</Link></li>)}</ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <nav aria-label="Decisions by spec" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {groups.map((g) => <a key={g.file} href={`#${slug(g.module)}`} className="text-slate-600 underline underline-offset-2 hover:text-slate-900">{title(g.module)} ({g.decisions.length})</a>)}
      </nav>

      {groups.map((g) => (
        <div key={g.file} id={slug(g.module)} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="flex flex-wrap items-baseline gap-2 font-semibold text-slate-900">
            {title(g.module)}
            <Link to={hrefFor({ kind: "doc", file: g.file })} className="text-xs font-normal text-slate-500 underline underline-offset-2 hover:text-slate-900">{g.file}</Link>
          </h3>
          <ol className="mt-2 divide-y divide-slate-100">
            {g.decisions.map((d) => (
              <li key={d.number} className="flex gap-3 py-2 text-sm">
                <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{d.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <Markdown html={inline(d.title, d.file)} className={`font-medium text-slate-900 ${prose}`} />
                    <span className="text-xs text-slate-500">{d.date}</span>
                  </div>
                  {d.text && <Markdown html={inline(d.text, d.file)} className={`mt-0.5 text-slate-700 ${prose}`} />}
                  <Link to={hrefFor({ kind: "doc", file: d.evidence.file, heading: d.evidence.heading })} className="mt-0.5 inline-block text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">
                    {d.evidence.file} › {d.evidence.heading}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
