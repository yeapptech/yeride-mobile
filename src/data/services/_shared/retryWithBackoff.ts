/**
 * Generic retry-with-backoff helper. Used by HTTP adapters that talk to
 * external services where transient transport failures (5xx, dropped
 * connections) deserve a quick retry but client errors (4xx) don't.
 *
 * Policy:
 *   - `attempts`     — total invocations including the first. So
 *                      `attempts: 3` means "try once, then up to 2 retries".
 *   - `delaysMs`     — delay BEFORE retry attempt N (zero-indexed). The
 *                      array length should be `attempts - 1`. If shorter,
 *                      the last value repeats; if longer, the tail is
 *                      ignored.
 *   - `shouldRetry`  — predicate over the rejection. Return `true` to
 *                      treat the failure as transient and retry; `false`
 *                      to give up immediately. Default: never retry.
 *
 * Programming errors (a synchronous throw inside `fn` itself, e.g. an
 * undefined-call) bubble up unchanged — the helper only intercepts
 * promise rejections.
 *
 * Returns whatever `fn` resolves to on the first successful attempt.
 * Throws the LAST rejection if every attempt fails.
 *
 * The helper does not use `Result` even though most callers will produce
 * `Result`-shaped values: a `Result.err` is a successful PROMISE
 * resolution, not a transport failure, so it shouldn't trigger retry.
 * Callers that want to retry on `Result.err` should map that to a thrown
 * error in their `fn` body and let the helper unwind.
 */
export interface RetryWithBackoffOptions {
  readonly attempts: number;
  readonly delaysMs: readonly number[];
  readonly shouldRetry: (error: unknown) => boolean;
  /**
   * Optional override for the sleep primitive — exposed so tests can
   * inject a synchronous resolved promise in place of `setTimeout` and
   * assert behavior without burning real wall-clock time.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryWithBackoffOptions,
): Promise<T> {
  if (options.attempts < 1) {
    throw new Error(
      `retryWithBackoff: attempts must be >= 1, got ${String(options.attempts)}`,
    );
  }
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let i = 0; i < options.attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const isLast = i === options.attempts - 1;
      if (isLast || !options.shouldRetry(e)) {
        throw e;
      }
      const delay =
        options.delaysMs[i] ??
        options.delaysMs[options.delaysMs.length - 1] ??
        0;
      await sleep(delay);
    }
  }
  // Unreachable: the loop always either returns or throws.
  /* istanbul ignore next */
  throw lastError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
