import { describe, expect, it } from "vitest";
import { hasAccess, MIN_KEY_LENGTH } from "../../core/access.ts";

// SPEC-public-release W2: the live functions need the owner's access key; the public site never sends one.
const KEY = "k".repeat(MIN_KEY_LENGTH);

describe("owner access key", () => {
  it("accepts the configured key sent as a bearer token", () => {
    expect(hasAccess(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it("refuses a request with no authorization header", () => {
    expect(hasAccess(null, KEY)).toBe(false);
  });

  it("refuses a wrong key, including one that shares a prefix or differs only in length", () => {
    expect(hasAccess(`Bearer ${KEY.slice(0, -1)}x`, KEY)).toBe(false);
    expect(hasAccess(`Bearer ${KEY}k`, KEY)).toBe(false);
    expect(hasAccess(`Bearer ${KEY.slice(1)}`, KEY)).toBe(false);
  });

  it("refuses the key in any scheme other than Bearer", () => {
    expect(hasAccess(KEY, KEY)).toBe(false);
    expect(hasAccess(`Basic ${KEY}`, KEY)).toBe(false);
  });

  it("refuses everything when no key is configured, so a missing variable locks the site instead of opening it", () => {
    expect(hasAccess("Bearer ", undefined)).toBe(false);
    expect(hasAccess("Bearer ", "")).toBe(false);
    expect(hasAccess("Bearer undefined", undefined)).toBe(false);
  });

  it(`refuses everything when the configured key is shorter than ${MIN_KEY_LENGTH} characters`, () => {
    const short = "s".repeat(MIN_KEY_LENGTH - 1);
    expect(hasAccess(`Bearer ${short}`, short)).toBe(false);
  });
});
