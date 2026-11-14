import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "../../core/result.ts";

describe("Result", () => {
  it("wraps a success value", () => {
    const result: Result<number> = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("wraps an error with a code and a user-facing message", () => {
    const result: Result<number> = err("too_large", "File exceeds 10 MB");
    expect(result).toEqual({ ok: false, error: { code: "too_large", message: "File exceeds 10 MB" } });
  });

  it("narrows on the ok flag", () => {
    const result: Result<string> = ok("x");
    if (!result.ok) throw new Error("expected success");
    expect(result.value.toUpperCase()).toBe("X");
  });
});
