import {
  crash as crashlyticsCrash,
  getCrashlytics,
  log as crashlyticsLog,
  recordError as crashlyticsRecordError,
  setAttributes as crashlyticsSetAttributes,
  setCrashlyticsCollectionEnabled,
  setUserId as crashlyticsSetUserId,
  type Crashlytics,
} from '@react-native-firebase/crashlytics';

import type { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import type { CrashReportingService } from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('Crashlytics');

/**
 * Single seam between the rewrite and `@react-native-firebase/crashlytics`.
 *
 * Uses the modular API (Phase 9 turn 14): named imports for `getCrashlytics`,
 * `setCrashlyticsCollectionEnabled`, `setUserId`, `setAttributes`,
 * `recordError`, `log`, `crash` — each takes the resolved `Crashlytics`
 * instance as the first argument. The legacy namespaced default-export
 * surface is still co-exported by RNFirebase 24 but slated for removal in
 * v25; the runtime fires deprecation warnings on every namespaced call
 * (e.g. `crashlytics().setUserId(...)`), which is what motivated this
 * migration.
 *
 * Why an adapter instead of using the modular SDK directly:
 *
 *   - Result-shaped failure handling. The SDK's async functions
 *     (`setUserId`, `setAttributes`, `setCrashlyticsCollectionEnabled`)
 *     return `Promise<null>` and reject on native-side failure. The
 *     adapter catches every reject and returns `Result.err(NetworkError)`
 *     so callers stay in the project's "no expected throws" pattern.
 *
 *   - Sync wrap of `log` / `recordError`. The SDK's `log(instance, message)`
 *     and `recordError(instance, error, name?)` are synchronous void
 *     functions. The adapter promotes them to
 *     `Promise<Result<void, NetworkError>>` so consumers (the logger
 *     transport, the global error handler) speak a uniform interface —
 *     and so we get an exception-mapping point in case the SDK ever
 *     throws synchronously.
 *
 *   - Centralized fail-closed semantics. Telemetry MUST NEVER break user
 *     flow. Every method here catches every error and degrades to a
 *     `Result.err(NetworkError({code: 'crashlytics_*'}))` rather than
 *     propagating. Callers (the lifecycle hook, the logger transport)
 *     log the failure and continue.
 *
 * Direct top-level import is fine here: the global jest mock in
 * `jest.setup.ts` (Phase 9 turn 3 sub-turn 3a, Task #10) replaces the
 * native module so unit tests don't fail at module load. The mock
 * exposes both the modular named functions (delegating to a memoized
 * singleton's per-method jest.fn()s so the existing assertion surface
 * is preserved) and the namespaced default for backward compatibility.
 *
 * Singleton handling: `getCrashlytics()` returns a per-process singleton,
 * memoized by the SDK. We resolve it lazily on first use (via
 * `getInstance()` below) so a subclass / test could override the
 * accessor without touching the SDK module — and so the adapter
 * survives a Jest reset between describe blocks (the global mock is
 * call-stable, but defensive lazy resolution costs nothing).
 *
 * Error code mapping:
 *   - `crashlytics_set_collection_enabled_failed`
 *   - `crashlytics_set_user_id_failed`
 *   - `crashlytics_set_attributes_failed`
 *   - `crashlytics_record_error_failed`
 *   - `crashlytics_log_failed`
 *
 * Each carries the original throw / reject reason in the NetworkError's
 * `cause` field so the logger has full context if the user ever opens
 * a bug report.
 */

/**
 * Three-state cache:
 *   - `undefined` — not yet resolved; next call attempts a fresh
 *     `getCrashlytics()` lookup.
 *   - `null`      — resolution failed; subsequent calls short-circuit
 *     to `null` without re-throwing. Sticky failure mode (matches legacy
 *     yeride's `crashlyticsInstance = false` sentinel).
 *   - `Crashlytics` — happy-path singleton.
 */
let _instance: Crashlytics | null | undefined = undefined;

/**
 * Lazy singleton accessor. Caches the result of the first
 * `getCrashlytics()` call. On throw (native module missing, App not
 * configured) the cache flips to `null` and stays there for the
 * lifetime of the process — every subsequent call short-circuits
 * without re-attempting resolution.
 */
function getInstance(): Crashlytics | null {
  if (_instance !== undefined) return _instance;
  try {
    _instance = getCrashlytics();
    return _instance;
  } catch (e) {
    logger.warn(
      '[getInstance] getCrashlytics() threw; telemetry will be a no-op',
      e,
    );
    _instance = null;
    return null;
  }
}

/**
 * Test-only escape hatch. Resets the cached singleton so a fresh mock
 * setup in `beforeEach` is picked up. Callers in production code MUST
 * NOT invoke this — there's no use case for it.
 */
export function __resetCrashlyticsInstanceForTests(): void {
  _instance = undefined;
}

function netError(code: string, cause: unknown): NetworkError {
  return new NetworkError({
    code,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export class FirebaseCrashlyticsAdapter implements CrashReportingService {
  async setCollectionEnabled(
    enabled: boolean,
  ): Promise<Result<void, NetworkError>> {
    const instance = getInstance();
    if (!instance) {
      return Result.err(
        netError(
          'crashlytics_native_unavailable',
          'getCrashlytics() returned null',
        ),
      );
    }
    try {
      await setCrashlyticsCollectionEnabled(instance, enabled);
      return Result.ok(undefined);
    } catch (e) {
      return Result.err(
        netError('crashlytics_set_collection_enabled_failed', e),
      );
    }
  }

  async setUserId(userId: UserId | null): Promise<Result<void, NetworkError>> {
    const instance = getInstance();
    if (!instance) {
      return Result.err(
        netError(
          'crashlytics_native_unavailable',
          'getCrashlytics() returned null',
        ),
      );
    }
    try {
      // Empty string clears the identity per the SDK's contract;
      // legacy yeride uses '' (not null) for the same reason.
      await crashlyticsSetUserId(
        instance,
        userId === null ? '' : String(userId),
      );
      return Result.ok(undefined);
    } catch (e) {
      return Result.err(netError('crashlytics_set_user_id_failed', e));
    }
  }

  async setAttributes(
    attributes: Record<string, string>,
  ): Promise<Result<void, NetworkError>> {
    const instance = getInstance();
    if (!instance) {
      return Result.err(
        netError(
          'crashlytics_native_unavailable',
          'getCrashlytics() returned null',
        ),
      );
    }
    try {
      await crashlyticsSetAttributes(instance, attributes);
      return Result.ok(undefined);
    } catch (e) {
      return Result.err(netError('crashlytics_set_attributes_failed', e));
    }
  }

  async recordError(
    error: Error,
    name?: string,
  ): Promise<Result<void, NetworkError>> {
    const instance = getInstance();
    if (!instance) {
      return Result.err(
        netError(
          'crashlytics_native_unavailable',
          'getCrashlytics() returned null',
        ),
      );
    }
    try {
      // SDK's recordError is sync void — wrap defensively in case a
      // future version makes it async or throws on a malformed Error.
      crashlyticsRecordError(instance, error, name);
      return Result.ok(undefined);
    } catch (e) {
      return Result.err(netError('crashlytics_record_error_failed', e));
    }
  }

  async log(message: string): Promise<Result<void, NetworkError>> {
    const instance = getInstance();
    if (!instance) {
      return Result.err(
        netError(
          'crashlytics_native_unavailable',
          'getCrashlytics() returned null',
        ),
      );
    }
    try {
      // SDK's log is sync void.
      crashlyticsLog(instance, message);
      return Result.ok(undefined);
    } catch (e) {
      return Result.err(netError('crashlytics_log_failed', e));
    }
  }

  crash(): void {
    const instance = getInstance();
    if (!instance) {
      // Force-crash on a system without Crashlytics — fall back to a
      // plain throw so the dev still gets a visible failure (the only
      // caller is a dev-only "Force crash" entry point in sub-turn 3c).
      throw new Error('crashlytics_native_unavailable: forced crash');
    }
    crashlyticsCrash(instance);
  }
}
