// Security audit 2026-10-11 (docs/security/2026-10-11-audit.md): the state-changing endpoints refuse requests a
// browser marks as cross-site, and the JSON ones refuse non-JSON bodies. Local, against netlify dev.
import { expect, test } from "./live.ts";

const RUN = "00000000-0000-4000-8000-000000000000"; // never exists: a request that got through would answer 404, not 403
const crossSite = { "sec-fetch-site": "cross-site" };

test("every state-changing endpoint refuses a cross-site request, before doing anything", async ({ request }) => {
  const cases = [
    request.post("/api/runs", { headers: crossSite, data: { document_id: RUN } }),
    request.post(`/api/runs/${RUN}/review`, { headers: crossSite, data: {} }),
    request.post(`/api/runs/${RUN}/post`, { headers: crossSite }),
    request.post("/api/upload", { headers: { "sec-fetch-site": "same-site" }, multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") } } }),
  ];
  for (const response of await Promise.all(cases)) {
    // netlify dev retries a 403 from the review function as ".../review.html", which the function answers with 405;
    // either way the request was refused before any work (the live site is checked separately for the 403).
    if (response.url().endsWith("/review") && response.status() === 405) continue;
    expect(response.status(), response.url()).toBe(403);
    expect(await response.json()).toEqual({ error: "Requests from other sites are not accepted." });
  }
});

test("the JSON endpoints refuse a text/plain body, the one a cross-site page could send without a preflight", async ({ request }) => {
  for (const path of ["/api/runs", `/api/runs/${RUN}/review`]) {
    const response = await request.post(path, { headers: { "content-type": "text/plain" }, data: JSON.stringify({ document_id: RUN }) });
    expect(response.status(), path).toBe(415);
  }
});

test("the app's own requests still work (same-origin)", async ({ request }) => {
  const response = await request.post("/api/runs", { headers: { "sec-fetch-site": "same-origin" }, data: { document_id: RUN } });
  expect(response.status()).toBe(404); // got through the guard: the document does not exist
});
