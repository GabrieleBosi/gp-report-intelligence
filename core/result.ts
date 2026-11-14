// Typed outcome for boundary operations: callers branch on `ok` instead of catching thrown strings.
export type AppError = { code: string; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T = never>(code: string, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
