import { useEffect, useState } from "react";
import { Link } from "react-router";
import { isLive } from "../lib/access.ts";
import { fetchSnapshotInfo } from "../lib/api.ts";

// One line on every page saying what the visitor is looking at (SPEC-public-release W2, ADR-0006).
export function ModeBanner() {
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  useEffect(() => {
    if (isLive()) return;
    const controller = new AbortController();
    fetchSnapshotInfo(controller.signal).then((info) => setExportedAt(info.exportedAt), () => {});
    return () => controller.abort();
  }, []);
  if (isLive()) {
    return (
      <p className="border-b border-red-200 bg-red-50 px-6 py-2 text-center text-sm text-red-900">
        Live mode: running the pipeline or uploading calls the model and counts against the daily budget.
      </p>
    );
  }

  const date = exportedAt ? new Date(exportedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <p className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-sm text-amber-900">
      Recorded runs of the real pipeline on synthetic reports{date ? `, exported ${date}` : ""}. Reviewing a run here
      happens in your browser and resets on reload.{" "}
      <Link to="/tour" className="font-medium underline underline-offset-2">Start with the tour</Link>
    </p>
  );
}
