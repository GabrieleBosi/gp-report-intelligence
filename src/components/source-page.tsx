import { useEffect, useState } from "react";
import { isLive } from "../lib/access.ts";
import { fetchPageImage, pageImageUrl } from "../lib/api.ts";

// The source page beside the figures (SPEC-review): the analyst checks a value against what the report prints.
// Images come from the snapshot, or from /api/runs/:id/pages/:n when live (rendered server-side, storage stays private).

// Live, the image needs the owner's key, which an <img> cannot send: fetch it and show it from a blob: URL.
function useLivePage(runId: string, page: number, enabled: boolean): { src: string | null; failed: boolean } {
  const [image, setImage] = useState<{ key: string; url: string | null } | null>(null);
  const key = `${runId}:${page}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let url: string | null = null;
    fetchPageImage(runId, page, controller.signal).then((blob) => {
      url = URL.createObjectURL(blob);
      setImage({ key, url });
    }, () => { if (!controller.signal.aborted) setImage({ key, url: null }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [runId, page, key, enabled]);
  const current = image?.key === key ? image : null;
  return { src: current?.url ?? null, failed: current !== null && current.url === null };
}

export function SourcePage({ runId, filename, pageCount, page, onPageChange, workbook }: {
  runId: string; filename: string; pageCount: number; page: number; onPageChange: (page: number) => void; workbook: boolean;
}) {
  const [status, setStatus] = useState<{ page: number; state: "loaded" | "error" } | null>(null);
  const live = isLive();
  const livePage = useLivePage(runId, page, live && !workbook);
  const state = livePage.failed ? "error" : status?.page === page ? status.state : "loading";
  const src = live ? livePage.src : pageImageUrl(filename, page);

  if (workbook) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        {filename} is a workbook: its cells are read exactly, so the figures table shows them with their sheet.
      </p>
    );
  }
  return (
    <figure className="rounded-lg border border-slate-200 bg-white">
      <figcaption className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm">
        <span className="font-medium text-slate-700">Source · page {page} of {pageCount}</span>
        <span className="flex gap-1" role="group" aria-label="Choose the page">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => onPageChange(n)} aria-current={n === page ? "page" : undefined}
              className={`h-7 w-7 rounded text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${n === page ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {n}
            </button>
          ))}
        </span>
      </figcaption>
      <div className="relative min-h-64 bg-slate-50">
        {state === "loading" && <p role="status" className="absolute inset-0 grid place-items-center text-sm text-slate-500">Rendering page {page}…</p>}
        {state === "error" && <p role="alert" className="p-4 text-sm text-red-700">Page {page} could not be shown.</p>}
        {src && <img key={page} src={src} alt={`Page ${page} of ${filename}`}
          onLoad={() => setStatus({ page, state: "loaded" })} onError={() => setStatus({ page, state: "error" })}
          className={`w-full ${state === "loaded" ? "" : "invisible"}`} />}
      </div>
    </figure>
  );
}
