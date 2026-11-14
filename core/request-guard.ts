// Refuses state-changing requests a browser makes on another site's behalf (security audit 2026-10-11, finding 1). The
// site password's cookie has no SameSite attribute, so Firefox and Safari would send it with a cross-site form POST.
// Browsers mark such requests with Sec-Fetch-Site (*.netlify.app siblings are "same-site", not same-origin); a JSON
// content type cannot be sent cross-site without a CORS preflight, which these functions never grant.
export type Refusal = { status: 403 | 415; error: string };

export function refuseForeignRequest(headers: Headers, options: { json?: boolean } = {}): Refusal | null {
  const site = headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site" || foreignOrigin(headers)) return { status: 403, error: "Requests from other sites are not accepted." };
  if (options.json && !(headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "Send JSON (content-type: application/json)." };
  }
  return null;
}

// Browsers without fetch metadata (Safari < 16.4, Firefox < 90) still send Origin on a cross-site POST (ship review
// 2026-10-12). Scripts send none, which is fine: they are not a browser carrying the password cookie.
function foreignOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== headers.get("host");
  } catch {
    return true; // "null" (sandboxed or opaque) or malformed
  }
}
