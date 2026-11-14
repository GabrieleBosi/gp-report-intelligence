// Retries an operation that failed for a reason that may go away (a timed-out connection, a 5xx from a gateway), with
// exponential backoff. Permanent errors (bad input, integrity failures) fail at once: retrying them only adds latency.
const TRANSIENT = /timed? ?out|timeout|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|\b50[234]\b|Bad Gateway|Service Unavailable/i;

export const isTransient = (error: unknown): boolean => error instanceof Error && TRANSIENT.test(error.message);

export async function withRetry<T>(operation: () => Promise<T>, {
  attempts = 3, baseDelayMs = 500, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
