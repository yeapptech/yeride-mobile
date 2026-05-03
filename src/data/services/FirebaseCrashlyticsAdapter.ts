import crashlytics from '@react-native-firebase/crashlytics';

import type { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import type { CrashReportingService } from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('Crashlytics');

/**
 * Single seam between the rewrite and `@react-native-firebase/crashlytics`.
 *
 * Why an adapter instead of importing crashlytics directly:
 *
 *   - Result-shaped failure handling. The SDK's async methods
 *     (`setUserId`, `setAttributes`, `setCrashlyticsCollectionEnabled`)
 *     return `Promise<null>` and reject on native-side failure. The
 *     adapter catches every reject and returns `Result.err(NetworkError)`
 *     so callers stay in the project's "no expected throws" pattern.
 *
 *   - Sync wrap of `log` / `recordError`. The SDK's `log(message)` and
 *     `recordError(error, name?)` are synchronous void methods. The
 *     adapter promotes them to `Promise<Result<void, NetworkError>>` so
 *     consumers (the logger transport, the global error handler) speak
 *     a uniform interface — and so we get an exception-mapping point in
 *     case the SDK ever throws synchronously (rare, but legacy yeride's
 *     wrapper has the same try/catch defense).
 *
 *   - Centralized fail-closed semantics. Telemetry MUST NEVER break user
 *     flow. Every method here catches every error and degrades to a
 *     `Result.err(NetworkError({code: 'crashlytics_*'}))` rather than
 *     propagating. Callers (the lifecycle hook, the logger transport)
 *     log the failure and continue.
 *
 * Direct top-level import is fine here: the global jest mock in
 * `jest.setup.ts` (Phase 9 turn 3 sub-turn 3a, Task #10) replaces the
 * native module so unit tests don't fail at module load. The legacy
 * yeride wrapper used a lazy `require()` because legacy's Jest setup
 * had no global mock — the rewrite's setup does.
 *
 * Singleton handling: `crashlytics()` returns a per-process singleton,
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

type CrashlyticsModule = ReturnType<typeof crashlytics>;

/**
 * Three-state cache:
 *   - `undefined` — not yet resolved; next call attempts a fresh
 *     `crashlytics()` lookup.
 *   - `null`      — resolution failed; subsequent calls short-circuit
 *     to `null` without re-throwing. Sticky failure mode (matches legacy
 *     yeride's `crashlyticsInstance = false` sentinel).
 *   - `Module`    — happy-path singleton.
 */
let _instance: CrashlyticsModule | null | undefined = undefined;

/**
 * Lazy singleton accessor. Caches the result of the first
 * `crashlytics()` call. On throw (native module missing, App not
 * configured) the cache flips to `null` and stays there for the
 * lifetime of the process — every subsequent call short-circuits
 * without re-attempting resolution.
 */
function getInstance(): CrashlyticsModule | null {
  if (_instance !== undefined) return _instance;
  try {
    _instance = crashlytics();
    return _instance;
  } catch (e) {
    logger.warn(
      '[getInstance] crashlytics() threw; telemetry will be a no-op',
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
          'crashlytics() returned null',
        ),
      );
    }
    try {
      await instance.setCrashlyticsCollectionEnabled(enabled);
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
          'crashlytics() returned null',
        ),
      );
    }
    try {
      // Empty string clears the identity per the SDK's contract;
      // legacy yeride uses '' (not null) for the same reason.
      await instance.setUserId(userId === null ? '' : String(userId));
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
          'crashlytics() returned null',
        ),
      );
    }
    try {
      await instance.setAttributes(attributes);
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
          'crashlytics() returned null',
        ),
      );
    }
    try {
      // SDK's recordError is sync void — wrap defensively in case a
      // future version makes it async or throws on a malformed Error.
      instance.recordError(error, name);
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
          'crashlytics() returned null',
        ),
      );
    }
    try {
      // SDK's log is sync void.
      instance.log(message);
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
    instance.crash();
  }
}
