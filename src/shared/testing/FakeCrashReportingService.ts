import type { UserId } from '@domain/entities/UserId';
import type { NetworkError } from '@domain/errors';
import type { CrashReportingService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `CrashReportingService` stand-in. Mirrors the real
 * `FirebaseCrashlyticsAdapter`'s surface 1:1 so use cases, lifecycle hooks,
 * and the logger transport can be tested without loading
 * `@react-native-firebase/crashlytics`.
 *
 * Surface mirrors `CrashReportingService` — same method names, same Result
 * shapes. Helpers:
 *
 *   - `seed*`     — prime initial state (e.g. `seedCollectionEnabled(true)`
 *                   to start a test with collection already on).
 *   - `failNext`  — make the next call to a method return `Result.err(error)`
 *                   one-shot.
 *   - `reset`     — wipe seed + spy + recorded state.
 *   - `spies`     — read-only call counts.
 *   - `get*` /
 *     `did*`      — read-only introspection of accumulated state for
 *                   assertions.
 *
 * `crash()` is captured via a `crashed: true` flag rather than actually
 * raising a fatal exception — tests assert the flag was set without taking
 * the Jest worker down.
 *
 * Pattern matches `FakePushNotificationService` /
 * `FakeBackgroundGeolocationClient` / `FakeStripeServerService`.
 */
export type FakeCrashReportingMethod =
  | 'setCollectionEnabled'
  | 'setUserId'
  | 'setAttributes'
  | 'recordError'
  | 'log';

export interface RecordedCrashError {
  readonly error: Error;
  readonly name: string | undefined;
}

export interface FakeCrashReportingSpies {
  readonly setCollectionEnabledCalls: number;
  readonly setUserIdCalls: number;
  readonly setAttributesCalls: number;
  readonly recordErrorCalls: number;
  readonly logCalls: number;
  readonly crashCalls: number;
}

export class FakeCrashReportingService implements CrashReportingService {
  private collectionEnabled: boolean | null = null;
  private userId: UserId | null = null;
  private attributes: Record<string, string> = {};
  private recordedErrors: RecordedCrashError[] = [];
  private breadcrumbs: string[] = [];
  private crashed = false;

  private nextFailures = new Map<FakeCrashReportingMethod, NetworkError>();

  private readonly _spies = {
    setCollectionEnabledCalls: 0,
    setUserIdCalls: 0,
    setAttributesCalls: 0,
    recordErrorCalls: 0,
    logCalls: 0,
    crashCalls: 0,
  };

  get spies(): FakeCrashReportingSpies {
    return this._spies;
  }

  /* ───── Seed helpers ───── */

  /**
   * Set the initial collection state. Defaults to `null` (never set, which
   * lets tests differentiate "explicitly disabled" from "never configured").
   */
  seedCollectionEnabled(value: boolean | null): void {
    this.collectionEnabled = value;
  }

  /** Set the initial user identity. Defaults to `null`. */
  seedUserId(userId: UserId | null): void {
    this.userId = userId;
  }

  /** Set the initial attributes map. Defaults to `{}`. */
  seedAttributes(attributes: Record<string, string>): void {
    this.attributes = { ...attributes };
  }

  /**
   * Prime the next call to `method` to return `Result.err(error)`. One-shot:
   * subsequent calls behave normally.
   */
  failNext(args: {
    method: FakeCrashReportingMethod;
    error: NetworkError;
  }): void {
    this.nextFailures.set(args.method, args.error);
  }

  /** Wipe seed + spy + accumulated state. */
  reset(): void {
    this.collectionEnabled = null;
    this.userId = null;
    this.attributes = {};
    this.recordedErrors = [];
    this.breadcrumbs = [];
    this.crashed = false;
    this.nextFailures.clear();
    this._spies.setCollectionEnabledCalls = 0;
    this._spies.setUserIdCalls = 0;
    this._spies.setAttributesCalls = 0;
    this._spies.recordErrorCalls = 0;
    this._spies.logCalls = 0;
    this._spies.crashCalls = 0;
  }

  /* ───── Public adapter surface (CrashReportingService) ───── */

  async setCollectionEnabled(
    enabled: boolean,
  ): Promise<Result<void, NetworkError>> {
    this._spies.setCollectionEnabledCalls += 1;
    const failure = this.takeFailure('setCollectionEnabled');
    if (failure) return Result.err(failure);
    this.collectionEnabled = enabled;
    return Result.ok(undefined);
  }

  async setUserId(userId: UserId | null): Promise<Result<void, NetworkError>> {
    this._spies.setUserIdCalls += 1;
    const failure = this.takeFailure('setUserId');
    if (failure) return Result.err(failure);
    this.userId = userId;
    return Result.ok(undefined);
  }

  async setAttributes(
    attributes: Record<string, string>,
  ): Promise<Result<void, NetworkError>> {
    this._spies.setAttributesCalls += 1;
    const failure = this.takeFailure('setAttributes');
    if (failure) return Result.err(failure);
    // Merge semantics: subsequent calls add/overwrite keys. Mirrors the
    // SDK's `setAttributes` semantic — there's no SDK call to clear an
    // attribute, you'd just overwrite it with an empty string.
    this.attributes = { ...this.attributes, ...attributes };
    return Result.ok(undefined);
  }

  async recordError(
    error: Error,
    name?: string,
  ): Promise<Result<void, NetworkError>> {
    this._spies.recordErrorCalls += 1;
    const failure = this.takeFailure('recordError');
    if (failure) return Result.err(failure);
    this.recordedErrors.push({ error, name });
    return Result.ok(undefined);
  }

  async log(message: string): Promise<Result<void, NetworkError>> {
    this._spies.logCalls += 1;
    const failure = this.takeFailure('log');
    if (failure) return Result.err(failure);
    this.breadcrumbs.push(message);
    return Result.ok(undefined);
  }

  crash(): void {
    this._spies.crashCalls += 1;
    this.crashed = true;
    // The real adapter would raise a fatal native exception. The fake
    // captures a flag instead so tests can assert without crashing the
    // Jest worker.
  }

  /* ───── Read-only test introspection ───── */

  getCollectionEnabled(): boolean | null {
    return this.collectionEnabled;
  }

  getUserId(): UserId | null {
    return this.userId;
  }

  getAttributes(): Readonly<Record<string, string>> {
    return { ...this.attributes };
  }

  getRecordedErrors(): readonly RecordedCrashError[] {
    return this.recordedErrors.slice();
  }

  getBreadcrumbs(): readonly string[] {
    return this.breadcrumbs.slice();
  }

  didCrash(): boolean {
    return this.crashed;
  }

  /* ───── Internals ───── */

  private takeFailure(method: FakeCrashReportingMethod): NetworkError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}
