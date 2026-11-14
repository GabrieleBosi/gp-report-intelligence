// The owner's access key for the live functions (SPEC-public-release W2, ADR-0006). Without it the site reads the
// recorded snapshot. Kept for the browser tab only (sessionStorage), and in memory where storage is unavailable.
export const STORAGE_KEY = "gp-report-intelligence.live-key";
let memory: string | null = null;

export function liveKey(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export const isLive = () => liveKey() !== null;

// Returns whether the browser kept the key for the tab: switching modes reloads the page, which a key held only in
// memory does not survive.
export function setLiveKey(key: string | null): boolean {
  memory = key;
  try {
    if (key === null) globalThis.sessionStorage?.removeItem(STORAGE_KEY);
    else globalThis.sessionStorage?.setItem(STORAGE_KEY, key);
    return key === null || globalThis.sessionStorage?.getItem(STORAGE_KEY) === key;
  } catch {
    return false; // storage blocked: the key lives in memory until the page reloads
  }
}
