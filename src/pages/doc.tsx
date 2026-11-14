import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Markdown } from "../components/markdown.tsx";
import { ARTIFACT_LOADERS } from "../showcase/artifacts.ts";
import { docTitle } from "../showcase/content.ts";
import { renderMarkdown } from "../showcase/markdown.ts";

type State = { status: "loading" } | { status: "ready"; text: string } | { status: "missing" } | { status: "error"; message: string };
type Loaded = { file: string; text: string } | { file: string; error: string };

// Showcase document viewer: a spec, plan, ADR, report or test from the repository, at /docs/<path in the repository>.
export function DocPage() {
  const file = useParams()["*"] ?? "";
  const load = ARTIFACT_LOADERS[file];
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then((text) => { if (live) setLoaded({ file, text }); })
      .catch((e: unknown) => { if (live) setLoaded({ file, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [file, load]);

  const state: State = !load ? { status: "missing" }
    : loaded?.file !== file ? { status: "loading" }
    : "error" in loaded ? { status: "error", message: loaded.error } : { status: "ready", text: loaded.text };

  const markdown = file.endsWith(".md");
  return (
    <article aria-labelledby="doc-heading" className="space-y-3">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link to="/process" className="underline underline-offset-2 hover:text-slate-900">How it was built</Link> › <span className="break-all">{file}</span>
      </nav>
      <h2 id="doc-heading" className="text-xl font-semibold text-slate-900">
        {state.status === "ready" ? docTitle(file, state.text) : file.split("/").at(-1)}
      </h2>
      {state.status === "loading" && <p role="status" className="text-sm text-slate-500">Loading the document…</p>}
      {state.status === "missing" && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">There is no document at {file}. <Link to="/process" className="underline">See all documents</Link>.</p>}
      {state.status === "error" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p>}
      {state.status === "ready" && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {markdown
            ? <Markdown html={renderMarkdown(state.text.replace(/^# .+\n/, ""), file)} className="doc-prose" />
            : <pre className="overflow-x-auto text-xs leading-relaxed text-slate-800"><code>{state.text}</code></pre>}
        </div>
      )}
    </article>
  );
}
