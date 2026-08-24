/**
 * Bounded wait helper for the realtime layer.
 *
 * Every dependency the realtime path touches (Turso outbox, cursor rows, the
 * Redis bus) is best-effort. SweetSocket serializes every command on a
 * connection, so ONE unbounded await — a hung query, a wedged Redis write —
 * would stall every subsequent message with no acknowledgement. `withTimeout`
 * races a promise against a hard ceiling: when the bound is exceeded the
 * caller receives `fallback` immediately and moves on. The underlying promise
 * keeps running; its eventual completion is harmless (outbox rows dedupe by
 * event id, cursor writes are idempotent, bus writes are fire-and-forget).
 */
export async function withTimeout<T, F>(
  promise: Promise<T>,
  ms: number,
  fallback: F,
): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T | F>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
