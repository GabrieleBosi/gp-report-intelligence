import { useId, useState, type FormEvent } from "react";
import { isLive, setLiveKey } from "../lib/access.ts";
import { verifyLiveKey } from "../lib/api.ts";

// The owner's way into live mode (SPEC-public-release W2, ADR-0006). The key is checked against the live functions
// before it is kept; switching reloads the page so every view reads from the new source.
export function OwnerAccess() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ busy: boolean; message?: string; warning?: string }>({ busy: false });
  const keyId = useId();

  if (isLive()) {
    return (
      <button type="button" onClick={() => { setLiveKey(null); window.location.reload(); }}
        className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900">Leave live mode</button>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
        className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">Owner access</button>
    );
  }

  function enter() {
    if (!setLiveKey(key.trim())) {
      setLiveKey(null);
      setState({ busy: false, message: "This browser does not keep session storage, so live mode would not survive the reload." });
      return;
    }
    window.location.reload();
  }

  // A warning (the backend is degraded) is shown first; a second click switches anyway.
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state.warning) { enter(); return; }
    setState({ busy: true });
    const result = await verifyLiveKey(key.trim()).catch(() => ({ ok: false as const, message: "The live functions could not be reached." }));
    if (!result.ok) { setState({ busy: false, message: result.message }); return; }
    if (result.warning) { setState({ busy: false, warning: result.warning }); return; }
    enter();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor={keyId} className="text-slate-600">Access key</label>
      <input id={keyId} type="password" value={key} onChange={(e) => { setKey(e.target.value); setState({ busy: false }); }} autoComplete="current-password" required
        className="w-48 rounded-md border border-slate-300 px-2 py-1" />
      <button type="submit" disabled={state.busy || !key.trim()}
        className="rounded-md bg-slate-900 px-2 py-1 font-medium text-white hover:bg-slate-700 disabled:bg-slate-400">{state.warning ? "Use live mode anyway" : "Use live mode"}</button>
      <button type="button" onClick={() => { setOpen(false); setState({ busy: false }); }} className="text-slate-500 underline">Cancel</button>
      {state.message && <p role="alert" className="basis-full text-red-700">{state.message}</p>}
      {state.warning && <p role="status" className="basis-full text-amber-800">{state.warning}</p>}
    </form>
  );
}
