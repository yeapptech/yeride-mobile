/**
 * A `Result<T, E>` represents the outcome of an operation that can fail in
 * an *expected* way. Use cases and value-object factories return Result
 * instead of throwing, so the caller is forced to handle both branches at
 * compile time.
 *
 * Programming errors (null pointer, division by zero, infrastructure crashes)
 * still throw — those are caught by the React error boundary.
 *
 * Example:
 *   const r = Email.create('foo@bar.com');
 *   if (!r.ok) return r;        // propagate
 *   const email = r.value;       // narrowed to Email
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Result = {
  ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },

  err<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },

  /**
   * Map the success value. If the result is an error, returns it unchanged.
   */
  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? Result.ok(fn(result.value)) : result;
  },

  /**
   * Chain another Result-returning operation. Short-circuits on the first
   * error.
   */
  flatMap<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Result<U, E>,
  ): Result<U, E> {
    return result.ok ? fn(result.value) : result;
  },

  /**
   * Run side-effecting code on the success value without changing it.
   */
  tap<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> {
    if (result.ok) fn(result.value);
    return result;
  },

  /**
   * Combine several Results into one. If any input is an error, returns the
   * first error encountered (left-to-right).
   */
  all<T extends readonly unknown[], E>(results: {
    [K in keyof T]: Result<T[K], E>;
  }): Result<T, E> {
    const values: unknown[] = [];
    for (const r of results) {
      if (!r.ok) return r;
      values.push(r.value);
    }
    return Result.ok(values as unknown as T);
  },

  /**
   * Wrap a throwing callback. Used at the boundary between this domain code
   * and infrastructure that may throw (e.g. JSON.parse).
   */
  fromThrowable<T, E>(fn: () => T, mapError: (e: unknown) => E): Result<T, E> {
    try {
      return Result.ok(fn());
    } catch (e) {
      return Result.err(mapError(e));
    }
  },
};
