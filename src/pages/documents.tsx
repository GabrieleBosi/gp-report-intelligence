import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { DocumentSummary } from "../../core/documents.ts";
import { Upload } from "../components/upload.tsx";
import { isLive } from "../lib/access.ts";
import { fetchDocuments, SNAPSHOT_ONLY, startRun } from "../lib/api.ts";
import { fileSize, quarterLabel } from "../lib/format.ts";

const FORMAT_LABEL: Record<string, string> = { native_pdf: "PDF", scanned_pdf: "Scanned PDF", xlsx: "Excel" };

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; documents: DocumentSummary[] };

export function DocumentsPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDocuments(controller.signal)
      .then((documents) => setState({ status: "ready", documents }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [reload]);

  return (
    <section aria-labelledby="documents-heading">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="documents-heading" className="text-base font-semibold text-slate-900">Documents</h2>
        {state.status === "ready" && <p className="text-sm text-slate-500">{state.documents.length} received</p>}
      </div>

      <Upload onUploaded={() => setReload((n) => n + 1)} />

      {state.status === "loading" && <p className="text-sm text-slate-500" role="status">Loading documents…</p>}
      {state.status === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{state.message}</p>
      )}
      {state.status === "ready" && state.documents.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">No documents yet.</p>
      )}
      {state.status === "ready" && state.documents.length > 0 && <DocumentsTable documents={state.documents} />}
    </section>
  );
}

function DocumentsTable({ documents }: { documents: DocumentSummary[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2.5">Document</th>
            <th scope="col" className="px-4 py-2.5">GP / fund</th>
            <th scope="col" className="px-4 py-2.5">Period</th>
            <th scope="col" className="px-4 py-2.5">Format</th>
            <th scope="col" className="px-4 py-2.5">Source</th>
            <th scope="col" className="px-4 py-2.5 text-right">Size</th>
            <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Pipeline</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {documents.map((doc) => {
            const meta = doc.corpus_meta;
            return (
              <tr key={doc.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-900">{doc.filename}</td>
                <td className="px-4 py-2.5 text-slate-700">
                  {meta ? <>{meta.gp_name}<span className="block text-xs text-slate-500">{meta.fund_name}</span></> : <Pending />}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{meta ? quarterLabel(meta.period_end) : <Pending />}</td>
                <td className="px-4 py-2.5 text-slate-700">{meta ? FORMAT_LABEL[meta.format] : doc.mime === "application/pdf" ? "PDF" : "Excel"}</td>
                <td className="px-4 py-2.5">
                  {meta ? <Badge tone="slate">Corpus · {meta.split === "heldout" ? "held out" : "dev"}</Badge> : <Badge tone="blue">Upload</Badge>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fileSize(doc.size_bytes)}</td>
                <td className="px-4 py-2.5 text-right"><RunButton documentId={doc.id} filename={doc.filename} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RunButton({ documentId, filename }: { documentId: string; filename: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<{ starting: boolean; error?: string }>({ starting: false });

  async function run() {
    setState({ starting: true });
    try {
      navigate(`/runs/${await startRun(documentId)}`);
    } catch (error) {
      setState({ starting: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button" onClick={run} disabled={state.starting || !isLive()} aria-label={`Run the pipeline on ${filename}`}
        title={isLive() ? undefined : SNAPSHOT_ONLY}
        className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {state.starting ? "Starting…" : "Run"}
      </button>
      {state.error && <p role="alert" className="max-w-48 text-right text-xs text-red-700">{state.error}</p>}
    </div>
  );
}

function Pending() {
  return <span className="text-slate-400" title="Filled in by classification (pipeline step 2)">Not yet classified</span>;
}

function Badge({ tone, children }: { tone: "slate" | "blue"; children: React.ReactNode }) {
  const tones = { slate: "bg-slate-100 text-slate-700 ring-slate-200", blue: "bg-blue-50 text-blue-700 ring-blue-200" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}
