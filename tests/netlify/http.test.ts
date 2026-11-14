import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_SECURITY_HEADERS, json } from "../../netlify/lib/http.ts";
import { ROOT } from "../support/dev-corpus.ts";

describe("API responses (security audit 2026-10-11: headers on function responses too)", () => {
  it("carry the security headers, are never cached, and keep status and body", async () => {
    const response = json({ error: "x" }, 409);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "x" });
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "cache-control": "no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
    });
    expect(API_SECURITY_HEADERS).not.toHaveProperty("cache-control"); // binary responses set their own caching
  });

  it("are built with the shared helper in every function, so a new endpoint cannot forget the headers", () => {
    const dir = path.join(ROOT, "netlify/functions");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/Response\.json\(/);
      expect(source, file).not.toMatch(/^const json = /m);
      if (/new Response\(/.test(source)) expect(source, file).toContain("API_SECURITY_HEADERS");
    }
  });
});
