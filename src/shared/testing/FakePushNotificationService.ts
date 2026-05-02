import type { PushPermissionStatus } from '@domain/entities/PushPermissionStatus';
import type { PushToken } from '@domain/entities/PushToken';
import type {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '@domain/errors';
import type {
  NotificationResponse,
  PushNotificationService,
} from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `PushNotificationService` stand-in. Mirrors the
 * real adapter's surface 1:1 so view-model and use-case tests can exercise
 * the push pipeline without touching `expo-notifications`.
 *
 * Surface mirrors `PushNotificationService` — same method names, same
 * Result shapes. The `emit*` helpers fire events into the registered
 * subscribers; the `seed*` helpers prime return values; `failNext` makes
 * the next call to a method return `Result.err(error)`.
 *
 * Pattern matches `FakeStripeServerService` / `FakeBackgroundGeolocationClient`
 * — every public method is one of:
 *   - a method on the wrapped SDK (returns Result; obeys failNext)
 *   - a `seed*` helper (sets state for the next read)
 *   - an `emit*` helper (synchronously fires a registered callback)
 *   - the `spies` getter (read-only access to call history)
 */
export type FakePushMethod =
  | 'getPermissionStatus'
  | 'requestPermissions'
  | 'getCurrentToken'
  | 'getLastNotificationResponse'
  | 'setupAndroidChannel';

type AnyPushError = NetworkError | AuthorizationError | ValidationError;

export interface FakePushSpies {
  readonly getPermissionStatusCalls: number;
  readonly requestPermissionsCalls: number;
  readonly getCurrentTokenCalls: number;
  readonly getLastNotificationResponseCalls: number;
  readonly setupAndroidChannelCalls: number;
  readonly tokenSubscribeCalls: number;
  readonly tokenUnsubscribeCalls: number;
  readonly responseSubscribeCalls: number;
  readonly responseUnsubscribeCalls: number;
}

export class FakePushNotificationService implements PushNotificationService {
  private permissionStatus: PushPermissionStatus = 'undetermined';
  private currentToken: PushToken | null = null;
  private lastResponse: NotificationResponse | null = null;
  private androidChannelConfigured = false;

  private tokenCallbacks = new Set<(token: PushToken | null) => void>();
  private responseCallbacks = new Set<(r: NotificationResponse) => void>();

  private nextFailures = new Map<FakePushMethod, AnyPushError>();

  private readonly _spies = {
    getPermissionStatusCalls: 0,
    requestPermissionsCalls: 0,
    getCurrentTokenCalls: 0,
    getLastNotificationResponseCalls: 0,
    setupAndroidChannelCalls: 0,
    tokenSubscribeCalls: 0,
    tokenUnsubscribeCalls: 0,
    responseSubscribeCalls: 0,
    responseUnsubscribeCalls: 0,
  };

  get spies(): FakePushSpies {
    return this._spies;
  }

  /* ───── Seed helpers ───── */

  /**
   * Set what `getPermissionStatus` and `requestPermissions` will return.
   * Defaults to `'undetermined'`.
   *
   * `requestPermissions` is documented to flip an `'undetermined'` state
   * to whatever the user picked. The fake honors that semantic: if you
   * seed `'undetermined'` then a test calls `requestPermissions`, the
   * fake leaves the seed alone (consumer should explicitly seed the
   * post-prompt state via `seedPermission(...)` BEFORE calling
   * `requestPermissions`). This matches the real adapter's behaviour
   * where the test author controls the OS prompt outcome via mock
   * setup, not via implicit transitions.
   */
  seedPermission(status: PushPermissionStatus): void {
    this.permissionStatus = status;
  }

  /**
   * Set what `getCurrentToken` will return. Defaults to `null` (no
   * token yet — matches a freshly-installed app before
   * `RegisterPushToken` runs).
   */
  seedToken(token: PushToken | null): void {
    this.currentToken = token;
  }

  /**
   * Set what `getLastNotificationResponse` will return. Defaults to
   * `null` (app was opened normally, not via a notification tap).
   */
  seedLastNotificationResponse(response: NotificationResponse | null): void {
    this.lastResponse = response;
  }

  /**
   * Prime the next call to `method` to return `Result.err(error)`.
   * One-shot: subsequent calls behave normally.
   */
  failNext(args: { method: FakePushMethod; error: AnyPushError }): void {
    this.nextFailures.set(args.method, args.error);
  }

  /** Wipe seed + spy + failure state. */
  reset(): void {
    this.permissionStatus = 'undetermined';
    this.currentToken = null;
    this.lastResponse = null;
    this.androidChannelConfigured = false;
    this.tokenCallbacks.clear();
    this.responseCallbacks.clear();
    this.nextFailures.clear();
    this._spies.getPermissionStatusCalls = 0;
    this._spies.requestPermissionsCalls = 0;
    this._spies.getCurrentTokenCalls = 0;
    this._spies.getLastNotificationResponseCalls = 0;
    this._spies.setupAndroidChannelCalls = 0;
    this._spies.tokenSubscribeCalls = 0;
    this._spies.tokenUnsubscribeCalls = 0;
    this._spies.responseSubscribeCalls = 0;
    this._spies.responseUnsubscribeCalls = 0;
  }

  /* ───── Emit helpers ───── */

  /**
   * Fire a token-refresh into every subscriber. Simulates FCM rotation
   * or APNs reissue.
   */
  emitTokenChange(token: PushToken | null): void {
    this.currentToken = token;
    for (const cb of [...this.tokenCallbacks]) cb(token);
  }

  /**
   * Fire a notification-response (a tap) into every subscriber. The
   * `lastResponse` slot is also updated so a subsequent
   * `getLastNotificationResponse` call returns this same shape — useful
   * for cold-start tap-routing tests that simulate the SDK buffering
   * the launching tap.
   */
  emitNotificationResponse(response: NotificationResponse): void {
    this.lastResponse = response;
    for (const cb of [...this.responseCallbacks]) cb(response);
  }

  /* ───── Public adapter surface (PushNotificationService) ───── */

  async getPermissionStatus(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  > {
    this._spies.getPermissionStatusCalls += 1;
    const failure = this.takeFailure('getPermissionStatus');
    if (failure)
      return Result.err(failure as NetworkError | AuthorizationError);
    return Result.ok(this.permissionStatus);
  }

  async requestPermissions(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  > {
    this._spies.requestPermissionsCalls += 1;
    const failure = this.takeFailure('requestPermissions');
    if (failure)
      return Result.err(failure as NetworkError | AuthorizationError);
    return Result.ok(this.permissionStatus);
  }

  async getCurrentToken(): Promise<
    Result<
      PushToken | null,
      NetworkError | AuthorizationError | ValidationError
    >
  > {
    this._spies.getCurrentTokenCalls += 1;
    const failure = this.takeFailure('getCurrentToken');
    if (failure) return Result.err(failure);
    return Result.ok(this.currentToken);
  }

  subscribeToTokenChanges(
    callback: (token: PushToken | null) => void,
  ): () => void {
    this._spies.tokenSubscribeCalls += 1;
    this.tokenCallbacks.add(callback);
    return () => {
      const removed = this.tokenCallbacks.delete(callback);
      if (removed) this._spies.tokenUnsubscribeCalls += 1;
    };
  }

  subscribeToNotificationResponse(
    callback: (response: NotificationResponse) => void,
  ): () => void {
    this._spies.responseSubscribeCalls += 1;
    this.responseCallbacks.add(callback);
    return () => {
      const removed = this.responseCallbacks.delete(callback);
      if (removed) this._spies.responseUnsubscribeCalls += 1;
    };
  }

  async getLastNotificationResponse(): Promise<
    Result<NotificationResponse | null, NetworkError>
  > {
    this._spies.getLastNotificationResponseCalls += 1;
    const failure = this.takeFailure('getLastNotificationResponse');
    if (failure) return Result.err(failure as NetworkError);
    return Result.ok(this.lastResponse);
  }

  async setupAndroidChannel(): Promise<Result<void, NetworkError>> {
    this._spies.setupAndroidChannelCalls += 1;
    const failure = this.takeFailure('setupAndroidChannel');
    if (failure) return Result.err(failure as NetworkError);
    this.androidChannelConfigured = true;
    return Result.ok(undefined);
  }

  /* ───── Read-only test introspection ───── */

  /** Whether `setupAndroidChannel` was successfully called at least once. */
  isAndroidChannelConfigured(): boolean {
    return this.androidChannelConfigured;
  }

  /** Number of currently-attached token-refresh subscribers. */
  getTokenSubscriberCount(): number {
    return this.tokenCallbacks.size;
  }

  /** Number of currently-attached notification-response subscribers. */
  getResponseSubscriberCount(): number {
    return this.responseCallbacks.size;
  }

  /* ───── Internals ───── */

  private takeFailure(method: FakePushMethod): AnyPushError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}
