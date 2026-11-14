import { describe, expect, it } from "vitest";
import { refuseForeignRequest } from "../../core/request-guard.ts";

const headers = (h: Record<string, string>) => new Headers(h);

describe("refuseForeignRequest (security audit 2026-10-11, finding 1: cross-site POSTs)", () => {
  it("refuses a request a browser marks as coming from another site, even a sibling *.netlify.app", () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(refuseForeignRequest(headers({ "sec-fetch-site": site }))).toEqual({ status: 403, error: "Requests from other sites are not accepted." });
    }
  });

  it("accepts the app's own requests, typed URLs, and clients that send no fetch metadata (scripts, tests)", () => {
    const cases: Record<string, string>[] = [{ "sec-fetch-site": "same-origin" }, { "sec-fetch-site": "none" }, {}];
    for (const h of cases) {
      expect(refuseForeignRequest(headers(h))).toBeNull();
    }
  });

  it("on JSON endpoints requires a JSON content type, which a cross-site form or text/plain fetch cannot send without a preflight", () => {
    expect(refuseForeignRequest(headers({ "content-type": "text/plain" }), { json: true }))
      .toEqual({ status: 415, error: "Send JSON (content-type: application/json)." });
    expect(refuseForeignRequest(headers({}), { json: true })).toMatchObject({ status: 415 });
    expect(refuseForeignRequest(headers({ "content-type": "application/json; charset=utf-8" }), { json: true })).toBeNull();
  });

  it("also refuses a foreign Origin, for browsers that send no fetch metadata (Safari < 16.4, Firefox < 90; ship review)", () => {
    const site = "gp-report-intelligence.netlify.app";
    expect(refuseForeignRequest(headers({ host: site, origin: "https://attacker.example" })))
      .toEqual({ status: 403, error: "Requests from other sites are not accepted." });
    expect(refuseForeignRequest(headers({ host: site, origin: "null" }))).toMatchObject({ status: 403 }); // sandboxed or opaque origin
    expect(refuseForeignRequest(headers({ host: site, origin: `https://${site}` }))).toBeNull();
    expect(refuseForeignRequest(headers({ host: "localhost:8888", origin: "http://localhost:8888" }))).toBeNull();
    expect(refuseForeignRequest(headers({ host: site }))).toBeNull(); // scripts and server-side clients send no Origin
  });
});
