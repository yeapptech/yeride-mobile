import type {
  BgGeofenceAction,
  BgGeofenceEvent,
  BgLocationEvent,
  BgPermissionStatus,
} from '@data/services/BackgroundGeolocationClient';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { RideId } from '@domain/entities/RideId';
import type { AuthorizationError, NetworkError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

/**
 * Programmable in-memory `BackgroundGeolocationClient` stand-in. Mirrors
 * the real adapter's surface 1:1 so view-model and use-case tests can
 * exercise the GPS pipeline without touching the SDK.
 *
 * Surface mirrors `BackgroundGeolocationClient` — same method names,
 * same Result shapes, same listener-level dedup. The `emit*` helpers
 * fire events into the registered subscribers; the `seed*` helpers
 * prime return values; `failNext({method, error})` makes the next call
 * to a method return `Result.err(error)`.
 *
 * The fake's dedup logic is implemented identically to the real
 * adapter so tests of dedup behavior exercise the same predicate.
 *
 * Pattern matches `FakeStripeServerService` / `FakeCloudFunctionsService`
 * — every public method is one of:
 *   - a method on the wrapped SDK (returns Result; obeys failNext)
 *   - a `seed*` helper (sets state for the next read)
 *   - an `emit*` helper (synchronously fires a registered callback)
 *   - the `spies` getter (read-only access to call history)
 */
export type FakeBgMethod =
  | 'init'
  | 'start'
  | 'stop'
  | 'addPickupGeofence'
  | 'removePickupGeofence'
  | 'removeAllGeofences'
  | 'getOdometer'
  | 'resetOdometer'
  | 'requestAuthorizationIfNeeded';

type AnyBgError = NetworkError | AuthorizationError;

export interface FakeBgGeofenceRecord {
  readonly identifier: 'pickup';
  readonly location: Coordinates;
  readonly radiusMeters: number;
  readonly rideId: RideId;
}

export interface FakeBgSpies {
  readonly initCalls: ReadonlyArray<{ distanceFilter: number }>;
  readonly startCalls: number;
  readonly stopCalls: number;
  readonly addPickupGeofenceCalls: ReadonlyArray<FakeBgGeofenceRecord>;
  readonly removePickupGeofenceCalls: number;
  readonly removeAllGeofencesCalls: number;
  readonly removeAllListenersCalls: number;
  readonly getOdometerCalls: number;
  readonly resetOdometerCalls: number;
  readonly requestAuthorizationCalls: number;
}

export class FakeBackgroundGeolocationClient {
  private initialized = false;
  private enabled = false;
  private odometerMeters = 0;
  private authorizationStatus: BgPermissionStatus = 'always';

  /** Currently-registered pickup geofence (single-shared, legacy parity). */
  private activeGeofence: FakeBgGeofenceRecord | null = null;

  /** Listener-level dedup mirrors the real adapter. */
  private lastLocationKey: string | null = null;
  private lastGeofenceKey: string | null = null;

  private locationCallbacks = new Set<(event: BgLocationEvent) => void>();
  private geofenceCallbacks = new Set<(event: BgGeofenceEvent) => void>();

  private nextFailures = new Map<FakeBgMethod, AnyBgError>();

  private readonly _spies = {
    initCalls: [] as Array<{ distanceFilter: number }>,
    startCalls: 0,
    stopCalls: 0,
    addPickupGeofenceCalls: [] as FakeBgGeofenceRecord[],
    removePickupGeofenceCalls: 0,
    removeAllGeofencesCalls: 0,
    removeAllListenersCalls: 0,
    getOdometerCalls: 0,
    resetOdometerCalls: 0,
    requestAuthorizationCalls: 0,
  };

  get spies(): FakeBgSpies {
    return this._spies;
  }

  /* ───── Seed helpers ───── */

  /**
   * Set what `requestAuthorizationIfNeeded` will return next. Defaults to
   * `'always'` so happy-path tests don't have to seed.
   */
  seedAuthorization(status: BgPermissionStatus): void {
    this.authorizationStatus = status;
  }

  /**
   * Set what `getOdometer` will return next. Mirrors the SDK's
   * cumulative-distance semantics — call `resetOdometer` to zero it.
   */
  seedOdometer(meters: number): void {
    this.odometerMeters = meters;
  }

  /**
   * Prime the next call to `method` to return `Result.err(error)`.
   * One-shot: subsequent calls behave normally.
   */
  failNext(args: { method: FakeBgMethod; error: AnyBgError }): void {
    this.nextFailures.set(args.method, args.error);
  }

  /** Wipe seed + spy + failure state. */
  reset(): void {
    this.initialized = false;
    this.enabled = false;
    this.odometerMeters = 0;
    this.authorizationStatus = 'always';
    this.activeGeofence = null;
    this.lastLocationKey = null;
    this.lastGeofenceKey = null;
    this.locationCallbacks.clear();
    this.geofenceCallbacks.clear();
    this.nextFailures.clear();
    this._spies.initCalls.length = 0;
    this._spies.startCalls = 0;
    this._spies.stopCalls = 0;
    this._spies.addPickupGeofenceCalls.length = 0;
    this._spies.removePickupGeofenceCalls = 0;
    this._spies.removeAllGeofencesCalls = 0;
    this._spies.removeAllListenersCalls = 0;
    this._spies.getOdometerCalls = 0;
    this._spies.resetOdometerCalls = 0;
    this._spies.requestAuthorizationCalls = 0;
  }

  /* ───── Emit helpers ───── */

  /**
   * Fire a single deduped location event into every subscriber. Tests
   * exercise the SDK multi-fire pattern by calling this back-to-back
   * with the same event.
   */
  emitLocation(event: BgLocationEvent): void {
    const key = `${event.coords.latitude},${event.coords.longitude},${String(event.timestampMs)},${String(event.odometerMeters)}`;
    if (key === this.lastLocationKey) return;
    this.lastLocationKey = key;
    for (const cb of [...this.locationCallbacks]) cb(event);
  }

  /**
   * Drive the SDK's "fires 2-3× per crossing" reality without writing
   * the same `emitLocation(...)` call multiple times in tests.
   */
  emitMultiFireLocation(event: BgLocationEvent, count: number): void {
    for (let i = 0; i < count; i += 1) this.emitLocation(event);
  }

  /**
   * Fire a deduped geofence event. Dedup key is
   * `(identifier, action, rideId)` so consecutive trips that re-register
   * the same `'pickup'` identifier each get their first fire through.
   */
  emitGeofence(event: BgGeofenceEvent): void {
    const key = `${event.identifier}:${event.action}:${event.rideId ?? ''}`;
    if (key === this.lastGeofenceKey) return;
    this.lastGeofenceKey = key;
    for (const cb of [...this.geofenceCallbacks]) cb(event);
  }

  emitMultiFireGeofence(event: BgGeofenceEvent, count: number): void {
    for (let i = 0; i < count; i += 1) this.emitGeofence(event);
  }

  /* ───── Public adapter surface ───── */

  async init(args: {
    distanceFilter: number;
    debug?: boolean;
  }): Promise<Result<true, NetworkError>> {
    this._spies.initCalls.push({ distanceFilter: args.distanceFilter });
    const failure = this.takeFailure('init');
    if (failure) return Result.err(failure as NetworkError);
    this.initialized = true;
    return Result.ok(true);
  }

  async start(): Promise<Result<true, NetworkError>> {
    this._spies.startCalls += 1;
    const failure = this.takeFailure('start');
    if (failure) return Result.err(failure as NetworkError);
    this.enabled = true;
    return Result.ok(true);
  }

  async stop(): Promise<Result<true, NetworkError>> {
    this._spies.stopCalls += 1;
    const failure = this.takeFailure('stop');
    if (failure) return Result.err(failure as NetworkError);
    this.enabled = false;
    this.lastLocationKey = null;
    this.lastGeofenceKey = null;
    return Result.ok(true);
  }

  async addPickupGeofence(args: {
    location: Coordinates;
    radiusMeters: number;
    rideId: RideId;
  }): Promise<Result<true, NetworkError>> {
    const record: FakeBgGeofenceRecord = {
      identifier: 'pickup',
      location: args.location,
      radiusMeters: args.radiusMeters,
      rideId: args.rideId,
    };
    this._spies.addPickupGeofenceCalls.push(record);
    const failure = this.takeFailure('addPickupGeofence');
    if (failure) return Result.err(failure as NetworkError);
    this.activeGeofence = record; // overwrite-on-add (mirrors SDK)
    return Result.ok(true);
  }

  async removePickupGeofence(): Promise<Result<true, NetworkError>> {
    this._spies.removePickupGeofenceCalls += 1;
    const failure = this.takeFailure('removePickupGeofence');
    if (failure) return Result.err(failure as NetworkError);
    this.activeGeofence = null;
    return Result.ok(true);
  }

  async removeAllGeofences(): Promise<Result<true, NetworkError>> {
    this._spies.removeAllGeofencesCalls += 1;
    const failure = this.takeFailure('removeAllGeofences');
    if (failure) return Result.err(failure as NetworkError);
    this.activeGeofence = null;
    return Result.ok(true);
  }

  subscribeToLocation(callback: (event: BgLocationEvent) => void): () => void {
    this.locationCallbacks.add(callback);
    return () => {
      this.locationCallbacks.delete(callback);
      if (this.locationCallbacks.size === 0) this.lastLocationKey = null;
    };
  }

  subscribeToGeofence(callback: (event: BgGeofenceEvent) => void): () => void {
    this.geofenceCallbacks.add(callback);
    return () => {
      this.geofenceCallbacks.delete(callback);
      if (this.geofenceCallbacks.size === 0) this.lastGeofenceKey = null;
    };
  }

  async getOdometer(): Promise<Result<number, NetworkError>> {
    this._spies.getOdometerCalls += 1;
    const failure = this.takeFailure('getOdometer');
    if (failure) return Result.err(failure as NetworkError);
    return Result.ok(this.odometerMeters);
  }

  async resetOdometer(): Promise<Result<true, NetworkError>> {
    this._spies.resetOdometerCalls += 1;
    const failure = this.takeFailure('resetOdometer');
    if (failure) return Result.err(failure as NetworkError);
    this.odometerMeters = 0;
    return Result.ok(true);
  }

  async requestAuthorizationIfNeeded(): Promise<
    Result<BgPermissionStatus, AuthorizationError>
  > {
    this._spies.requestAuthorizationCalls += 1;
    const failure = this.takeFailure('requestAuthorizationIfNeeded');
    if (failure) return Result.err(failure as AuthorizationError);
    return Result.ok(this.authorizationStatus);
  }

  async removeAllListeners(): Promise<void> {
    this._spies.removeAllListenersCalls += 1;
    this.locationCallbacks.clear();
    this.geofenceCallbacks.clear();
  }

  /* ───── Read-only test introspection ───── */

  /**
   * Currently-registered pickup geofence, or `null` if none. Lets tests
   * assert that a `removePickupGeofence` actually cleared state.
   */
  getActiveGeofence(): FakeBgGeofenceRecord | null {
    return this.activeGeofence;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /* ───── Internals ───── */

  private takeFailure(method: FakeBgMethod): AnyBgError | null {
    const f = this.nextFailures.get(method);
    if (!f) return null;
    this.nextFailures.delete(method);
    return f;
  }
}

/**
 * Re-exported type aliases so test files can `import type` without
 * crossing into the data layer.
 */
export type {
  BgGeofenceAction,
  BgGeofenceEvent,
  BgLocationEvent,
  BgPermissionStatus,
};
