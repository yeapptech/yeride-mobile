import type { CrashReportingService } from '@domain/services';

import type { LogLevel, LogTransport } from './Logger';

/**
 * Logger transport that fans `LOG.*` calls into the Crashlytics SDK.
 *
 * Two responsibilities:
 *
 *   1. **Breadcrumb buffer** — every level (debug / info / warn / error)
 *      flows into `crashReporting.log(formatted)`. The SDK retains the
 *      last ~64 messages in a per-process ring buffer and includes them
 *      in any subsequent crash report. This means when a crash actually
 *      happens, the report carries the most recent app context (which
 *      screen, which mutation, which network call).
 *
 *   2. **Non-fatal error capture** — at `'error'` level, if `meta` is an
 *      `Error` instance (or has an `error` field that is), the transport
 *      additionally fires `crashReporting.recordError(error, scope)`.
 *      Each recorded error appears in the Firebase Console as a separate
 *      issue, NOT as a crash — they're crash-grouped non-fatal captures
 *      that help triage degraded experiences without a crash.
 *
 * **Triggering rule** (Phase 9 turn 3 sub-turn 3a, kickoff decision (b)):
 *   - Always call `log()` (every level).
 *   - Call `recordError()` ONLY if level === 'error' AND we can extract
 *     a real `Error` from meta. Constructed Errors lose the original
 *     stack, so we don't manufacture one from the scope+message.
 *   - The global JS error handler (sub-turn 3b) covers the case where
 *     an uncaught throw happens outside any logger call.
 *
 * **Async-fire-and-forget** — the Crashlytics service methods are
 * `Promise<Result<void, NetworkError>>`. The transport's `log(...)`
 * method must be synchronous (per the `LogTransport` contract) — and
 * logger calls are deeply embedded in code paths that can't easily
 * await. So we fire the promise and intentionally do NOT await it.
 * The promise's eventual resolution is ignored — failures inside
 * `recordError` / `log` would be swallowed by the SDK anyway, and even
 * if they surface as Result.err the right move is "swallow" (telemetry
 * must never break user flow). The compiler warning about a floating
 * promise is suppressed via the explicit `void` operator.
 */
export class CrashlyticsLogTransport implements LogTransport {
  constructor(private readonly crashReporting: CrashReportingService) {}

  log(
    level: LogLevel,
    scope: string,
    message: string,
    meta?: unknown,
    rawMeta?: unknown,
  ): void {
    // Breadcrumb fan-out — every level. Format mirrors the
    // `[scope] message` shape the console transport produces, so a
    // crash report's breadcrumb section is human-readable next to the
    // Logcat / Xcode console.
    const formatted = `[${scope}] ${message}`;
    void this.crashReporting.log(formatted);

    // Non-fatal error fan-out — only at error level, only when meta
    // carries a real Error.
    //
    // **Phase 9 turn 6**: prefer `rawMeta` over `meta` for the
    // extraction. The logger pipeline strips `Error` instances via
    // `sanitizeForLogging` before they reach `meta` — converting them
    // to plain `{name, message, stack}` objects that fail
    // `extractError`'s `instanceof Error` check. The `rawMeta` channel
    // carries the un-sanitized original payload precisely so this
    // transport can still see the real Error reference. Falling back
    // to `meta` keeps direct `transport.log(...)` test calls (which
    // bypass the logger pipeline) working with the 4-arg form.
    if (level === 'error') {
      const err = extractError(rawMeta ?? meta);
      if (err !== null) {
        // The `name` arg to recordError tags the issue domain in
        // Firebase Console for triage (e.g. `'YeRide:RIDE'`,
        // `'YeRide:GPS:lifecycle'`). We use the logger's scope so
        // grouping matches the call site naturally.
        void this.crashReporting.recordError(err, scope);
      }
    }
  }
}

/**
 * Try to extract an `Error` instance from a logger meta argument. The
 * project's call sites pass meta in three common shapes:
 *
 *   1. `logger.error('scope', e)` where `e` is the Error directly
 *   2. `logger.error('scope', { error: e, ...context })` — Error nested
 *      inside a context bag
 *   3. `logger.error('scope', { code, message, ... })` — domain error
 *      details with no actual Error
 *
 * Shapes (1) and (2) extract; shape (3) returns `null` and the
 * transport skips `recordError`. The breadcrumb fan-out still runs in
 * shape (3) so the message text lands in any subsequent crash.
 */
function extractError(meta: unknown): Error | null {
  if (meta instanceof Error) return meta;
  if (
    meta !== null &&
    typeof meta === 'object' &&
    'error' in meta &&
    (meta as { error: unknown }).error instanceof Error
  ) {
    return (meta as { error: Error }).error;
  }
  return null;
}
