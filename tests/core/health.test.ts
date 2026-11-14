import { describe, expect, it } from "vitest";
import { checkHealth } from "../../core/health.ts";

const KEY = "sk-ant-test-secret-value";

describe("checkHealth", () => {
  it("reports ok when the API key is present and there are no probes", async () => {
    const report = await checkHealth({ version: "deploy-1", env: { ANTHROPIC_API_KEY: KEY } });

    expect(report).toEqual({ status: "ok", version: "deploy-1", anthropicKeyPresent: true, checks: {} });
  });

  it("reports degraded when the API key is missing", async () => {
    const report = await checkHealth({ version: "deploy-1", env: {} });

    expect(report.status).toBe("degraded");
    expect(report.anthropicKeyPresent).toBe(false);
  });

  it("treats an empty API key as missing", async () => {
    const report = await checkHealth({ version: "deploy-1", env: { ANTHROPIC_API_KEY: "  " } });

    expect(report.anthropicKeyPresent).toBe(false);
  });

  it("records each probe result by name", async () => {
    const report = await checkHealth({
      version: "deploy-1",
      env: { ANTHROPIC_API_KEY: KEY },
      probes: { db: async () => true, storage: async () => false },
    });

    expect(report.checks).toEqual({ db: "ok", storage: "fail" });
    expect(report.status).toBe("degraded");
  });

  it("marks a throwing probe as failed without leaking its error message", async () => {
    const report = await checkHealth({
      version: "deploy-1",
      env: { ANTHROPIC_API_KEY: KEY },
      probes: { db: async () => { throw new Error("password=hunter2"); } },
    });

    expect(report.checks).toEqual({ db: "fail" });
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("never includes the API key value in the report", async () => {
    const report = await checkHealth({ version: "deploy-1", env: { ANTHROPIC_API_KEY: KEY } });

    expect(JSON.stringify(report)).not.toContain(KEY);
  });

  it("marks a probe that exceeds the timeout as failed instead of hanging", async () => {
    const report = await checkHealth({
      version: "deploy-1",
      env: { ANTHROPIC_API_KEY: KEY },
      probes: { db: () => new Promise<boolean>(() => {}) },
      timeoutMs: 20,
    });

    expect(report.checks).toEqual({ db: "fail" });
  });
});
