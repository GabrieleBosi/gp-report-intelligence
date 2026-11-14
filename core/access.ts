// Owner access to the live functions (SPEC-public-release W2, ADR-0006). The public site reads a static snapshot and
// never calls them; the owner sends the key as a bearer token. A missing or short key refuses everything, so a
// configuration mistake locks the live functions instead of opening them.
export const MIN_KEY_LENGTH = 32;

export function hasAccess(authorization: string | null, key: string | undefined): boolean {
  if (!key || key.length < MIN_KEY_LENGTH || !authorization?.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice("Bearer ".length), key);
}

// Compares every position of the longer string, so the time taken does not reveal how much of a guess was right.
function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
