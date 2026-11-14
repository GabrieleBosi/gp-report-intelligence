import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withAccess } from "../../netlify/lib/access.ts";
import { ROOT } from "../support/dev-corpus.ts";

// SPEC-public-release W2: every function with a URL refuses a request without the owner's key before it reads any
// other configuration. Database, storage and model clients are all built from environment variables, so a function
// that reads nothing but LIVE_ACCESS_KEY has touched none of them.
const dir = path.join(ROOT, "netlify/functions");
const withPath = readdirSync(dir).filter((f) => f.endsWith(".ts"))
  .filter((f) => /export const config[^;]*\bpath:/s.test(readFileSync(path.join(dir, f), "utf8")));
const KEY = "k".repeat(32);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubEnv(values: Record<string, string> = {}) {
  const get = vi.fn((name: string) => values[name]);
  vi.stubGlobal("Netlify", { env: { get } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no network in this test"); }));
  return get;
}

describe("owner access on the live functions", () => {
  it("covers every function with a URL, and only those (the scheduled keep-alive has none)", () => {
    expect(withPath.length).toBeGreaterThanOrEqual(11);
    expect(withPath).not.toContain("keep-alive.ts");
    for (const file of withPath) {
      expect(readFileSync(path.join(dir, file), "utf8"), `${file} must export its handler through withAccess`)
        .toMatch(/export default withAccess\(/);
    }
  });

  it.each(withPath)("%s answers 401 without the key and reads no other configuration", async (file) => {
    const get = stubEnv({ LIVE_ACCESS_KEY: KEY });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = (await import(path.join(dir, file))).default as (req: Request, ctx: unknown) => Promise<Response | undefined>;

    for (const method of ["GET", "POST"]) {
      const response = await handler(new Request("http://localhost/api/x", { method }), { params: {} });
      expect(response?.status, `${file} ${method}`).toBe(401);
    }
    expect(new Set(get.mock.calls.map(([name]) => name))).toEqual(new Set(["LIVE_ACCESS_KEY"]));
  });

  it("refuses everything when LIVE_ACCESS_KEY is not configured", async () => {
    stubEnv();
    const inner = vi.fn(async () => new Response("ok"));
    const response = await withAccess(inner)(new Request("http://localhost/", { headers: { authorization: `Bearer ${KEY}` } }), {} as never);
    expect(response?.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes a request with the right key through to the function unchanged", async () => {
    stubEnv({ LIVE_ACCESS_KEY: KEY });
    const inner = vi.fn(async () => new Response("ok"));
    const request = new Request("http://localhost/", { headers: { authorization: `Bearer ${KEY}` } });
    const context = { params: { id: "x" } } as never;
    const response = await withAccess(inner)(request, context);
    expect(await response?.text()).toBe("ok");
    expect(inner).toHaveBeenCalledWith(request, context);
  });

  it("says how to authenticate, with the API's security headers and no caching", async () => {
    stubEnv({ LIVE_ACCESS_KEY: KEY });
    const response = await withAccess(async () => new Response("ok"))(new Request("http://localhost/"), {} as never);
    expect(response?.headers.get("www-authenticate")).toBe("Bearer");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.json()).toEqual({ error: "This needs the owner's access key. The public site reads a recorded snapshot." });
  });
});
