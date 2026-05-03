import type { UserId } from '../entities/UserId';
import type { NetworkError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over `@react-native-firebase/crashlytics`. The data layer's
 * `FirebaseCrashlyticsAdapter` (Phase 9 turn 3) speaks the SDK directly; the
 * domain interface keeps presentation (`useCrashReportingLifecycle` — Phase 9
 * turn 3 sub-turn 3b) and the logger transport
 * (`CrashlyticsLogTransport` — sub-turn 3a) free of SDK imports.
 *
 * Why an adapter instead of importing `@react-native-firebase/crashlytics`
 * directly:
 *
 *   - The SDK is a singleton with one concrete instance per native binding.
 *     Wrapping it in a `Result`-returning facade keeps consumers in the
 *     project's "no expected throws" pattern even though the SDK methods
 *     rarely actually throw (they buffer locally and upload async).
 *
 *   - Lazy module load — the adapter must not import
 *     `@react-native-firebase/crashlytics` at top level because Jest fails
 *     at module load without a native mock. Legacy yeride's
 *     `logger.config.js` solves this with `getCrashlytics()` lazy resolver
 *     + a try/catch fail-closed fallback. The rewrite mirrors that pattern
 *     inside the adapter.
 *
 *   - Collection state, user identity, and attribute keys are configured
 *     during the lifecycle hook (post-auth resolution). The interface keeps
 *     those as discrete operations so the lifecycle hook composes them
 *     without reaching into the SDK.
 *
 * Error semantics:
 *   - `NetworkError`  — SDK threw, native module missing, or the device
 *     can't reach Firebase Crashlytics's collection endpoint. Treated as
 *     non-fatal in callers — telemetry must never break user flow. The
 *     logger transport swallows these into the breadcrumb buffer; the
 *     lifecycle hook logs and continues.
 *
 * Conventions:
 *   - `setCollectionEnabled(false)` is honored even after the SDK has
 *     started buffering events (the SDK clears its on-disk buffer when
 *     collection flips off). Callers that need build-time gating should
 *     ALSO set the `firebase_crashlytics_collection_enabled` Info.plist /
 *     AndroidManifest meta-data key — `setCollectionEnabled` is a runtime
 *     override, not a replacement.
 *   - `setUserId(null)` clears the identity. Legacy yeride uses an empty
 *     string for the same purpose; the adapter normalizes both to the
 *     SDK's clear semantic.
 *   - `setAttributes` accepts a plain `Record<string, string>` so the
 *     lifecycle hook can pass `{role, env}` (legacy parity) or extend
 *     with additional keys (`active_service_area_id`, `active_vehicle_id`)
 *     without changing the interface.
 *   - `recordError(error, name?)` — the optional `name` is a Crashlytics
 *     "domain" tag (legacy uses `'ReactErrorBoundary'` for component-stack
 *     captures). Defaults to the error's class name.
 *   - `log(message)` — adds a breadcrumb to the next crash report. The SDK
 *     retains the last ~64 messages; older ones drop on rotation. The
 *     logger transport (Phase 9 turn 3 sub-turn 3a) routes ALL log levels
 *     through this for breadcrumb context, not just errors.
 *   - `crash()` — synchronous, no Result. Used only by the dev-only
 *     "Force crash" button (sub-turn 3c) to verify the upload pipeline
 *     end-to-end. Calls the SDK's `crash()` which raises a fatal native
 *     exception immediately. There is no recovery path.
 */
export interface CrashReportingService {
  /**
   * Enable or disable Crashlytics data collection for the current process.
   * Persists across launches inside the SDK's keychain / shared-preferences
   * store, so a subsequent build with the opposite default still reflects
   * the runtime override.
   *
   * Phase 9 turn 3 wires this from `useCrashReportingLifecycle` to
   * `__DEV__ ? false : true` — collection on for stage + production
   * builds, off for dev / debug builds (per project decision).
   */
  setCollectionEnabled(enabled: boolean): Promise<Result<void, NetworkError>>;

  /**
   * Tag subsequent crash reports with a user identifier. Pass `null` (or
   * an empty branded UserId) to clear the identity on sign-out. The SDK
   * persists the value across launches until explicitly cleared.
   *
   * The lifecycle hook calls this immediately after auth resolves
   * (legacy yeride parity — see `AppContent.js` lines ~380-390).
   */
  setUserId(userId: UserId | null): Promise<Result<void, NetworkError>>;

  /**
   * Set or replace custom keys on subsequent crash reports. Crashlytics
   * supports up to 64 attributes per report; additional keys are silently
   * dropped by the SDK. Each key/value is truncated to 1024 chars.
   *
   * Legacy yeride sets `{role, env}` after user-doc resolution. Phase 9
   * turn 3 mirrors that pair; future polish may extend with
   * `active_service_area_id` / `active_vehicle_id` for triage.
   *
   * Implementation note: legacy uses the plural `setAttributes(record)`
   * form. The SDK also exposes `setAttribute(key, value)` (singular) —
   * both work, but the bulk form is one round-trip and matches legacy.
   */
  setAttributes(
    attributes: Record<string, string>,
  ): Promise<Result<void, NetworkError>>;

  /**
   * Record a non-fatal error to the next crash report. The error's
   * stack trace, class name, and message are all captured; any additional
   * context lives in breadcrumb logs (`log()`) or attributes
   * (`setAttributes()`).
   *
   * Wired from two places in Phase 9 turn 3:
   *   - The logger transport (`CrashlyticsLogTransport`) — fires on every
   *     `LOG.extend(...).error(...)` call site that has an Error object
   *     in `meta`.
   *   - The global JS error handler in `AppContent.tsx` (sub-turn 3b),
   *     which wraps `ErrorUtils.setGlobalHandler` to capture uncaught JS
   *     errors before RN's red-box. Mirrors legacy's pattern verbatim.
   *
   * `name` is a Crashlytics "domain" tag — useful for grouping non-fatal
   * captures by source (e.g. `'ReactErrorBoundary'`,
   * `'GlobalErrorHandler'`, `'TripDispatch'`). Defaults to the error's
   * class name.
   */
  recordError(error: Error, name?: string): Promise<Result<void, NetworkError>>;

  /**
   * Add a breadcrumb to the next crash report. The SDK retains the last
   * ~64 messages and includes them in any subsequent crash; older
   * messages drop on rotation.
   *
   * The logger transport (`CrashlyticsLogTransport`) fans every log
   * level (debug / info / warn / error) through this method so the
   * breadcrumb buffer carries the most recent context regardless of
   * severity. ERROR-level messages additionally fire `recordError()`.
   */
  log(message: string): Promise<Result<void, NetworkError>>;

  /**
   * Force a fatal crash. SYNCHRONOUS — does not return. Calls the SDK's
   * `crash()` which raises an unhandled native exception immediately.
   *
   * Used only by the dev-only "Force crash" entry point (sub-turn 3c)
   * to verify the dSYM upload + Firebase Console pipeline end-to-end.
   * Production builds gate the entry point on `__DEV__` so a tester
   * can't trigger this without a dev build.
   *
   * No `Result` return: the function never completes normally.
   */
  crash(): void;
}
