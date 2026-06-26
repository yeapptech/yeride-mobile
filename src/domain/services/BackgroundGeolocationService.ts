import type { Coordinates } from '../entities/Coordinates';
import type { RideId } from '../entities/RideId';
import type { AuthorizationError, NetworkError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over `react-native-background-geolocation` (Transistor
 * Software). The data layer's `BackgroundGeolocationClient` (Phase 7
 * turn 1) speaks the SDK directly; the domain interface keeps
 * presentation (`useGpsLifecycle`, `useGpsStore`, `usePermissionRefresh`)
 * free of SDK imports.
 *
 * Why an adapter instead of importing the SDK directly:
 *
 *   - The SDK API is callback-flavored (init via `ready()`, listener
 *     registration through `onLocation`/`onGeofence`, geofence
 *     registration by string identifier with arbitrary `extras`).
 *     Wrapping it in a domain-shaped facade keeps `useGpsLifecycle`
 *     thin and stops the SDK's surface from leaking into 12 different
 *     view-model files.
 *
 *   - The SDK fires `onLocation` and `onGeofence` 2-3× per physical
 *     update. Listener-level dedup lives behind this interface so
 *     callers never see the duplicates. Subscribers compose freely;
 *     the underlying SDK listener is registered once.
 *
 *   - The SDK throws on transient failures (permission revocation,
 *     native OS hand-off mid-call). The implementation catches at the
 *     boundary and maps to `NetworkError` / `AuthorizationError`
 *     `Result`s so use cases stay in the project's "no expected
 *     throws" pattern.
 *
 * Geofence identifier convention:
 *
 *   - Bare `'pickup'` (legacy parity, kickoff decision C). The SDK's
 *     `addGeofence` overwrite semantics replace any existing entry
 *     with the same identifier, so callers don't need an explicit
 *     "remove before add" dance. The dynamic `rideId` rides on
 *     `extras.rideId` so the event handler can correlate the fire
 *     with the active trip.
 *
 *   - Single-shared identifier means at most one pickup geofence is
 *     registered per session — the user is either a rider or a
 *     driver for one trip at a time, which matches legacy behaviour.
 *
 *   - The dropoff geofence is reserved for symmetry but not
 *     registered in Phase 7 scope.
 *
 * Lifecycle:
 *
 *   - `init()` — must be called exactly once per app launch (mirrors
 *     legacy `initBackgroundGeolocation()`). Idempotent: re-calling
 *     against an already-initialized SDK is a no-op.
 *
 *   - `start()` — gates on `getState().enabled` and short-circuits if
 *     already on (legacy `gpsStart` pattern). Idempotent.
 *
 *   - `stop()` — idempotent.
 *
 *   - `removeAllListeners()` + `removeAllGeofences()` — used by
 *     AppContent's logout handler to wipe state synchronously enough
 *     that the next login starts fresh.
 *
 * Error mapping at the boundary:
 *
 *   - SDK throw on `ready` / `start` / `stop` / geofence ops →
 *     `NetworkError` with `cause` carrying the original.
 *   - `requestAuthorizationIfNeeded` returns `denied` as
 *     `Result.ok('denied')` (not an error — the user is allowed to
 *     say no). Returns `AuthorizationError` only if the SDK throws
 *     while computing the prompt.
 */

/* ───── Domain-shaped types exported to the rest of the codebase ───── */

/**
 * One delivery from the SDK, normalised to domain values. Speed and
 * odometer are nullable because the SDK reports `-1` / `0` when GPS is
 * indoors or warming up.
 */
export interface BgLocationEvent {
  readonly coords: Coordinates;
  /** Speed in meters per second, or `null` if unavailable. */
  readonly speed: number | null;
  /**
   * Direction of travel in degrees clockwise from true north (0–360), or
   * `null` when the SDK can't report it (no GPS fix / stationary — it
   * reports `-1` in that case). Used to rotate the driver car marker.
   */
  readonly heading: number | null;
  /** Cumulative distance traveled this session, in meters. */
  readonly odometerMeters: number;
  /** Device system time at recording, as `Date.getTime()` ms. */
  readonly timestampMs: number;
  /** True if the SDK reports the device as currently moving. */
  readonly isMoving: boolean;
}

export type BgGeofenceAction = 'ENTER' | 'EXIT';

/**
 * One delivery from the SDK's geofence stream. `rideId` is reconstructed
 * from `extras.rideId` set at registration time; `null` if the geofence
 * was registered without rideId metadata or the round-trip dropped it.
 */
export interface BgGeofenceEvent {
  readonly identifier: string;
  readonly action: BgGeofenceAction;
  readonly rideId: RideId | null;
  readonly coords: Coordinates | null;
  readonly timestampMs: number;
}

/**
 * Authorization level granted by the OS. `'always'` is the goal for
 * background tracking; `'when_in_use'` works only while the app is
 * foregrounded (the geofence pipeline degrades to
 * polled-evaluations-while-foreground in that case). `'denied'` /
 * `'undetermined'` mean the SDK can't fire `onLocation` at all.
 */
export type BgPermissionStatus =
  | 'always'
  | 'when_in_use'
  | 'denied'
  | 'undetermined';

export interface BackgroundGeolocationClientInitArgs {
  /** SDK's `distanceFilter` config — meters between deliveries. Legacy default: 200. */
  readonly distanceFilter: number;
  /** Enable verbose SDK logging. Defaults to false (release-safe). */
  readonly debug?: boolean;
}

/**
 * Domain interface for the background-geolocation seam. The data-layer
 * `BackgroundGeolocationClient` and the in-memory
 * `FakeBackgroundGeolocationClient` both `implements` this interface, so
 * `Container.bgGeolocation` is typed as `BackgroundGeolocationService`
 * (no `Real | Fake` union leakage into the presentation layer).
 */
export interface BackgroundGeolocationService {
  /**
   * Initialize the SDK. Idempotent: a second call against an already-
   * initialized SDK is a no-op. Must be called once before `start()`.
   */
  init(
    args: BackgroundGeolocationClientInitArgs,
  ): Promise<Result<true, NetworkError>>;

  /**
   * Start emitting location + geofence events. Idempotent: short-
   * circuits if already enabled. Requires a successful `init()`.
   */
  start(): Promise<Result<true, NetworkError>>;

  /**
   * Stop emitting location + geofence events. Idempotent. Listener
   * subscriptions are NOT torn down by `stop()` — call
   * `removeAllListeners()` for that.
   */
  stop(): Promise<Result<true, NetworkError>>;

  /**
   * Register the pickup geofence (single-shared `'pickup'` identifier;
   * see class comment). Calling again replaces the previous
   * registration — overwrite semantics, no explicit remove needed.
   */
  addPickupGeofence(args: {
    location: Coordinates;
    radiusMeters: number;
    rideId: RideId;
  }): Promise<Result<true, NetworkError>>;

  /**
   * Remove the pickup geofence. Idempotent (no-op if none registered).
   */
  removePickupGeofence(): Promise<Result<true, NetworkError>>;

  /**
   * Wipe every registered geofence. Used by AppContent's logout +
   * unmount paths so a stale geofence from the prior session doesn't
   * fire after the user signs out.
   */
  removeAllGeofences(): Promise<Result<true, NetworkError>>;

  /**
   * Subscribe to deduped location updates. Multiple callers register
   * against ONE underlying SDK listener; the SDK fires 2-3× per
   * physical update and the implementation filters consecutive
   * identical events out via a dedup key.
   *
   * Returns a synchronous disposer (legacy
   * `subscribeToUserLocation` returned a Promise — explicitly
   * rewritten to synchronous unsubscribe to fix React's effect-cleanup
   * footgun).
   */
  subscribeToLocation(callback: (event: BgLocationEvent) => void): () => void;

  /**
   * Subscribe to deduped geofence transitions. Same single-listener +
   * dedup pattern as `subscribeToLocation`. Dedup key is
   * `(identifier, action, rideId)`.
   */
  subscribeToGeofence(callback: (event: BgGeofenceEvent) => void): () => void;

  /**
   * Read the cumulative distance the SDK has tracked this session.
   * Used by `Start ride` / `Request payment` to feed real GPS distance
   * into the entity transitions (Phase 7 turn 3).
   */
  getOdometer(): Promise<Result<number, NetworkError>>;

  /**
   * Zero the odometer. Used at the start of a new tracking session.
   */
  resetOdometer(): Promise<Result<true, NetworkError>>;

  /**
   * Trigger the OS permission dialog if needed. Resolves with the
   * granted authorization status. `'denied'` is `Result.ok('denied')`
   * (the user is allowed to say no); `AuthorizationError` is reserved
   * for cases where the SDK itself throws while computing the prompt.
   */
  requestAuthorizationIfNeeded(): Promise<
    Result<BgPermissionStatus, AuthorizationError>
  >;

  /**
   * Bulk-cleanup safety net. Called by AppContent's logout handler
   * alongside `stop()` + `removeAllGeofences()` so the next login
   * starts with no stale event handlers. Best-effort: failures are
   * swallowed (the next session's adapter instance is fresh).
   */
  removeAllListeners(): Promise<void>;
}
