import { useId, useRef, useState, type DragEvent } from "react";
import type { DocumentSummary } from "../../core/documents.ts";
import { UPLOAD_LIMITS } from "../../core/guardrails.ts";
import { isLive } from "../lib/access.ts";
import { SNAPSHOT_ONLY, uploadDocument } from "../lib/api.ts";

type State =
  | { status: "idle" }
  | { status: "uploading"; filename: string; progress: number }
  | { status: "done"; message: string }
  | { status: "rejected"; message: string };

const MAX_MB = UPLOAD_LIMITS.maxBytes / 1024 / 1024;

// Upload a GP report (PDF or Excel). The server applies every guardrail; the browser only pre-checks the size so an
// oversized file is never sent.
export function Upload({ onUploaded }: { onUploaded: (document: DocumentSummary) => void }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  async function send(file: File | undefined) {
    if (!file || state.status === "uploading") return;
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      setState({ status: "rejected", message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; files up to ${MAX_MB} MB are accepted.` });
      return;
    }
    setState({ status: "uploading", filename: file.name, progress: 0 });
    const outcome = await uploadDocument(file, (progress) => setState({ status: "uploading", filename: file.name, progress }));
    if (input.current) input.current.value = "";
    if (!outcome.ok) { setState({ status: "rejected", message: outcome.message }); return; }
    setState({ status: "done", message: outcome.duplicate
      ? `${outcome.document.filename} was already uploaded; it is in the list below.`
      : `${outcome.document.filename} was uploaded. Run the pipeline from the list; uploads are always reviewed by an analyst before posting.` });
    onUploaded(outcome.document);
  }

  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); if (isLive()) void send(event.dataTransfer.files[0]); };

  return (
    <div className="mb-4 space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}
        className={`flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm ${dragging ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white"}`}
      >
        <label className="cursor-pointer rounded-md bg-slate-900 has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-slate-400 px-3 py-1.5 font-medium text-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 hover:bg-slate-700">
          Upload a report
          <input ref={input} type="file" accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only" aria-describedby={hintId} disabled={!isLive() || state.status === "uploading"}
            onChange={(e) => void send(e.target.files?.[0])} />
        </label>
        <p id={hintId} className="text-slate-500">{isLive() ? `or drop it here · PDF or Excel (.xlsx), up to ${MAX_MB} MB and ${UPLOAD_LIMITS.maxPages} pages` : SNAPSHOT_ONLY}</p>
      </div>

      {state.status === "uploading" && (
        <div role="status" className="flex items-center gap-3 text-sm text-slate-600">
          <span>Uploading {state.filename}…</span>
          <progress className="h-2 w-40" max={1} value={state.progress} aria-label={`Upload progress for ${state.filename}`} />
        </div>
      )}
      {state.status === "done" && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{state.message}</p>}
      {state.status === "rejected" && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{state.message}</p>}
    </div>
  );
}
