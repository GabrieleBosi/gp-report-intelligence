// Every function response carries security headers (security audit 2026-10-11): netlify.toml's [[headers]] apply to
// the site's pages, not to function responses. These responses are data, never rendered as a page.
export const API_SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...API_SECURITY_HEADERS, "cache-control": "no-store" } });
