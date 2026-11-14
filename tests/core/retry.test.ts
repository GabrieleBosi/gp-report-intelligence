import { describe, expect, it } from "vitest";
import { isTransient, withRetry } from "../../core/retry.ts";

const noWait = { sleep: async () => {} };

describe("withRetry", () => {
  it("retries a transient failure and returns the eventual result", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      if (++calls < 3) throw new Error("download document: The connection to the database timed out");
      return "ok";
    }, { attempts: 3, ...noWait });

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the attempt limit with the last error", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error("503 Service Unavailable"); }, { attempts: 3, ...noWait }))
      .rejects.toThrow(/503/);
    expect(calls).toBe(3);
  });

  it("fails at once on a non-transient error (retrying cannot fix it)", async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error("integrity check failed: hash mismatch"); }, { attempts: 3, ...noWait }))
      .rejects.toThrow(/integrity/);
    expect(calls).toBe(1);
  });

  it("waits longer before each retry (exponential backoff)", async () => {
    const waits: number[] = [];
    await withRetry(async () => { throw new Error("ECONNRESET"); }, { attempts: 3, baseDelayMs: 200, sleep: async (ms) => { waits.push(ms); } })
      .catch(() => {});
    expect(waits).toEqual([200, 400]);
  });
});

describe("isTransient", () => {
  it.each(["The connection to the database timed out", "fetch failed", "ECONNRESET", "502 Bad Gateway", "504 Gateway Timeout", "socket hang up"])(
    "treats %j as transient", (message) => expect(isTransient(new Error(message))).toBe(true));

  it.each(["Bucket not found", "invalid input syntax for type uuid", "integrity check failed"])(
    "treats %j as permanent", (message) => expect(isTransient(new Error(message))).toBe(false));
});
