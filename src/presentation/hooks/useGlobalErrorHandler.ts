import { useEffect } from 'react';

import { useCrashReporting } from '@presentation/di';
import { LOG } from '@shared/logger';

const logger = LOG.extend('GlobalErrorHandler');

/**
 * Wrap React Native's global JS error handler so uncaught throws fan
 * out through Crashlytics before the red-box (in dev) / silent crash
 * (in production) takes the app down.
 *
 * **AppContent-only**. Mount this hook exactly once, at the very top
 * of the React tree, inside `AppContent.tsx`, alongside
 * `useCrashReportingLifecycle`. Both consume the DI container's
 * `crashReporting` slot but cover orthogonal cases:
 *
 *   - `useCrashReportingLifecycle` owns SDK *configuration* (collection
 *     toggle, user identity, attributes).
 *   - `useGlobalErrorHandler` owns *uncaught-throw capture*. Inside
 *     a logger call, the `CrashlyticsLogTransport` (sub-turn 3a)
 *     already routes errors to `recordError`. This hook covers the
 *     case where the throw happens outside any logger call —
 *     unhandled promise rejections from a useEffect, errors thrown
 *     from a callback inside a third-party library, etc.
 *
 * Mirrors the legacy `yeride/AppContent.js` block (lines ~312-325)
 * verbatim:
 *
 *   1. Capture the previous handler via `ErrorUtils.getGlobalHandler()`.
 *   2. Install a wrapper that fires
 *      `crashReporting.recordError(error, 'GlobalErrorHandler')` and
 *      (when `isFatal`) `crashReporting.log('Fatal JS error')` before
 *      chaining to the captured handler.
 *   3. On cleanup, restore the previous handler.
 *
 * Telemetry safety:
 *   - The wrapper's two SDK calls are wrapped in a try/catch — telemetry
 *     must never preempt the chain to the previous handler. A throw
 *     inside `recordError` (rare but possible) is silently swallowed
 *     so React Native still gets to render its red-box / abort the
 *     bundle as normal.
 *   - The SDK calls are fire-and-forget — `recordError` and `log` both
 *     return `Promise<Result<void, NetworkError>>` but the global
 *     handler is synchronous (RN doesn't await it). The promises'
 *     eventual resolutions are ignored; failures inside the SDK are
 *     swallowed by the SDK itself.
 *
 * Test-env safety:
 *   - `ErrorUtils` is a React Native global. Under Node / Jest it may
 *     be undefined (depends on jest-expo's setup). The hook guards
 *     against that and silently no-ops — no throws, no warnings.
 *
 * What this hook is NOT:
 *   - An ErrorBoundary. React component-stack capture is a separate UI
 *     concern (deferred to Turn 6 cleanup grab-bag).
 *   - A replacement for try/catch. Handlers that can recover should
 *     still catch + log explicitly so the app keeps running. This
 *     hook is the catch-net for throws that escape every other
 *     handler.
 */

/**
 * Minimal typed view of React Native's `ErrorUtils` global. Defined
 * locally because `@types/react-native` deprecated the official typing
 * in 0.74; reaching for `globalThis as any` would trip the no-explicit-
 * any rule.
 */
interface RNErrorUtils {
  getGlobalHandler(): GlobalErrorHandler | null | undefined;
  setGlobalHandler(handler: GlobalErrorHandler): void;
}

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

function getErrorUtils(): RNErrorUtils | null {
  const candidate = (globalThis as unknown as { ErrorUtils?: RNErrorUtils })
    .ErrorUtils;
  if (candidate === undefined) return null;
  if (
    typeof candidate.getGlobalHandler !== 'function' ||
    typeof candidate.setGlobalHandler !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export function useGlobalErrorHandler(): void {
  const crashReporting = useCrashReporting();

  useEffect(() => {
    const errorUtils = getErrorUtils();
    if (errorUtils === null) {
      // Test / Node env without React Native's global. Silent no-op.
      return;
    }

    const previousHandler = errorUtils.getGlobalHandler() ?? null;

    const wrapper: GlobalErrorHandler = (error, isFatal) => {
      try {
        // Fire-and-forget — the global handler is synchronous and
        // the SDK methods buffer locally before any async upload.
        void crashReporting.recordError(error, 'GlobalErrorHandler');
        if (isFatal === true) {
          void crashReporting.log('Fatal JS error');
        }
      } catch (telemetryError) {
        // Logging via the project logger is safe — even if the
        // CrashlyticsLogTransport (also wired in this session) throws,
        // its CompositeTransport parent isolates per-transport
        // failures. We don't re-throw because the chain to the
        // previous handler must always run.
        logger.warn('telemetry capture failed', telemetryError);
      }
      // Always chain. RN's default handler is what triggers the
      // red-box (dev) or abort (production); skipping it would
      // silently swallow real crashes.
      if (previousHandler) {
        previousHandler(error, isFatal);
      }
    };

    errorUtils.setGlobalHandler(wrapper);

    return () => {
      // Synchronous cleanup. Restore the previous handler so a
      // remount (rare in production, common in tests) doesn't
      // accumulate wrapper layers.
      if (previousHandler !== null) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, [crashReporting]);
}
