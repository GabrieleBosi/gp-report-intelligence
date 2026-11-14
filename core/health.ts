// Liveness + readiness summary for /api/health. Never makes a paid LLM call and never echoes secrets.
export type Probe = () => Promise<boolean>;

export type HealthDeps = {
  version: string;
  env: Record<string, string | undefined>;
  probes?: Record<string, Probe>;
  timeoutMs?: number;
};

export type HealthReport = {
  status: "ok" | "degraded";
  version: string;
  anthropicKeyPresent: boolean;
  checks: Record<string, "ok" | "fail">;
};

export async function checkHealth({ version, env, probes = {}, timeoutMs = 3000 }: HealthDeps): Promise<HealthReport> {
  const anthropicKeyPresent = Boolean(env.ANTHROPIC_API_KEY?.trim());

  const results = await Promise.all(
    Object.entries(probes).map(async ([name, probe]) => {
      const healthy = await withTimeout(probe(), timeoutMs).catch(() => false);
      return [name, healthy ? "ok" : "fail"] as const;
    }),
  );
  const checks = Object.fromEntries(results);

  const healthy = anthropicKeyPresent && results.every(([, result]) => result === "ok");
  return { status: healthy ? "ok" : "degraded", version, anthropicKeyPresent, checks };
}

// A hung dependency must degrade /api/health, not hang it.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
