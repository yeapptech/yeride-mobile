import BackgroundGeolocation, {
  type GeofenceEvent as SdkGeofenceEvent,
  type Location as SdkLocation,
  type State as SdkState,
} from 'react-native-background-geolocation';

import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { AuthorizationError, NetworkError } from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('BgGeolocation');

/**
 * Single seam between the rewrite and Transistor Software's
 * `react-native-background-geolocation` SDK.
 *
 * Why an adapter instead of importing the SDK directly:
 *
 *   - The SDK API is callback-flavored (init via `ready()`, listener
 *     registration through `onLocation`/`onGeofence`, geofence registration
 *     by string identifier with arbitrary `extras`). Wrapping it in a
 *     domain-shaped facade keeps `useGpsLifecycle` (Phase 7 turn 2) thin
 *     and stops the SDK's surface from leaking into 12 different view-
 *     model files.
 *
 *   - The SDK fires `onLocation` and `onGeofence` 2-3× per physical
 *     update (legacy CLAUDE.md note about background-geolocation
 *     multi-fire). Listener-level dedup lives in this class so callers
 *     never see the duplicates. Subscribers compose freely; the underlying
 *     SDK listener is registered once.
 *
 *   - The SDK throws on transient failures (permission revocation, native
 *     OS hand-off mid-call). We catch at this boundary and map to
 *     `NetworkError` / `AuthorizationError` `Result`s so use cases stay
 *     in the project's "no expected throws" pattern.
 *
 * Geofence identifier convention:
 *
 *   - Bare `'pickup'` (legacy parity, kickoff decision C). The SDK's
 *     `addGeofence` overwrite semantics replace any existing entry with
 *     the same identifier, so we don't need an explicit "remove before
 *     add" dance. The dynamic `rideId` rides on `extras.rideId` so the
 *     event handler can correlate the fire with the active trip.
 *
 *   - Single-shared identifier means at most one pickup geofence is
 *     registered per session — the user is either a rider or a driver
 *     for one trip at a time, which matches legacy behaviour.
 *
 *   - The dropoff geofence is reserved for symmetry but not registered
 *     in Phase 7 scope.
 *
 * Lifecycle:
 *
 *   - `init()` — must be called exactly once per app launch (mirrors legacy
 *     `initBackgroundGeolocation()`). Idempotent: re-calling against an
 *     already-initialized SDK is a no-op. `reset: true` is set so
 *     persisted-config drift across installs is forced clean on every
 *     launch (legacy comment about `stopOnTerminate` being ignored without
 *     `reset`).
 *
 *   - `start()` — gates on `getState().enabled` and short-circuits if
 *     already on (legacy `gpsStart` pattern). Idempotent.
 *
 *   - `stop()` — idempotent.
 *
 *   - `removeAllListeners()` + `removeAllGeofences()` — used by AppContent's
 *     logout handler to wipe state synchronously enough that the next
 *     login starts fresh.
 *
 * Error mapping:
 *
 *   - SDK throw on `ready` / `start` / `stop` / geofence ops →
 *     `NetworkError` with `cause` carrying the original.
 *   - `requestAuthorizationIfNeeded` returns `denied` as
 *     `Result.ok('denied')` (not an error — the user is allowed to say no).
 *     Returns `AuthorizationError` only if the SDK throws while computing
 *     the prompt.
 */

/* ───── Types ───── */

/**
 * One delivery from the SDK, normalised to domain values. Speed and
 * odometer are nullable because the SDK reports `-1` / `0` when GPS is
 * indoors or warming up.
 */
export interface BgLocationEvent {
  readonly coords: Coordinates;
  /** Speed in meters per second, or `null` if unavailable. */
  readonly speed: number | null;
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

/* ───── Adapter ───── */

export class BackgroundGeolocationClient {
  /**
   * Set on the first successful `init()`. The SDK itself tolerates a
   * second `ready()` call but it returns the cached state without
   * re-applying config — we'd rather log "already initialised" than
   * silently no-op a re-init the caller might be expecting to take.
   */
  private initialized = false;

  /** Most-recent dedup key from `subscribeToLocation`. Resets on stop. */
  private lastLocationKey: string | null = null;

  /** Most-recent dedup key from `subscribeToGeofence`. Resets on stop. */
  private lastGeofenceKey: string | null = null;

  /** Single underlying SDK location listener, shared by all subscribers. */
  private locationCallbacks = new Set<(event: BgLocationEvent) => void>();
  private locationSubscription: { remove: () => void } | null = null;

  /** Single underlying SDK geofence listener, shared by all subscribers. */
  private geofenceCallbacks = new Set<(event: BgGeofenceEvent) => void>();
  private geofenceSubscription: { remove: () => void } | null = null;

  async init(
    args: BackgroundGeolocationClientInitArgs,
  ): Promise<Result<true, NetworkError>> {
    if (this.initialized) {
      logger.info('init: already initialized — no-op');
      return Result.ok(true);
    }
    try {
      await BackgroundGeolocation.ready({
        // Force re-apply config on every launch. Without this, persisted
        // config from a prior install can mask `stopOnTerminate: true` —
        // legacy gpsLocation.js comment.
        reset: true,
        // Geolocation
        desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
        distanceFilter: args.distanceFilter,
        // Activity recognition: how long the SDK waits before declaring the
        // device stationary (5s = legacy default).
        stopTimeout: 5,
        // Application
        locationAuthorizationRequest: 'Always',
        backgroundPermissionRationale: {
          title:
            'Allow YeRide Next to access your location even when the app is in the background.',
          message:
            'YeRide Next uses location data to track trips, estimate arrival times, and calculate distances traveled. This data is required for the trip-tracking and pickup-area features.',
          positiveAction: 'Enable "{backgroundPermissionOptionLabel}"',
          negativeAction: 'Cancel',
        },
        debug: args.debug ?? false,
        logLevel: args.debug
          ? BackgroundGeolocation.LOG_LEVEL_VERBOSE
          : BackgroundGeolocation.LOG_LEVEL_ERROR,
        // Storage
        locationsOrderDirection: 'DESC',
        maxDaysToPersist: 14,
        // CRITICAL: stop tracking when the user force-quits the app, and
        // do NOT auto-start on device boot. Matches legacy contract.
        stopOnTerminate: true,
        startOnBoot: false,
      });
      this.initialized = true;
      logger.info('init: SDK ready');
      return Result.ok(true);
    } catch (e) {
      logger.error('init failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_init_failed',
          message: 'Could not initialize background geolocation',
          cause: e,
        }),
      );
    }
  }

  async start(): Promise<Result<true, NetworkError>> {
    try {
      const state = (await BackgroundGeolocation.getState()) as SdkState;
      if (state.enabled) {
        logger.info('start: already enabled — no-op');
        return Result.ok(true);
      }
      await BackgroundGeolocation.start();
      logger.info('start: tracking enabled');
      return Result.ok(true);
    } catch (e) {
      logger.error('start failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_start_failed',
          message: 'Could not start background geolocation',
          cause: e,
        }),
      );
    }
  }

  async stop(): Promise<Result<true, NetworkError>> {
    try {
      await BackgroundGeolocation.stop();
      this.lastLocationKey = null;
      this.lastGeofenceKey = null;
      logger.info('stop: tracking disabled');
      return Result.ok(true);
    } catch (e) {
      logger.error('stop failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_stop_failed',
          message: 'Could not stop background geolocation',
          cause: e,
        }),
      );
    }
  }

  async addPickupGeofence(args: {
    location: Coordinates;
    radiusMeters: number;
    rideId: RideId;
  }): Promise<Result<true, NetworkError>> {
    try {
      await BackgroundGeolocation.addGeofence({
        identifier: 'pickup',
        latitude: args.location.latitude,
        longitude: args.location.longitude,
        radius: args.radiusMeters,
        notifyOnEntry: true,
        notifyOnExit: true,
        notifyOnDwell: false,
        extras: { rideId: String(args.rideId) },
      });
      logger.info('addPickupGeofence: registered', {
        rideId: String(args.rideId),
        radius: String(args.radiusMeters),
      });
      return Result.ok(true);
    } catch (e) {
      logger.error('addPickupGeofence failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_add_geofence_failed',
          message: 'Could not register pickup geofence',
          cause: e,
        }),
      );
    }
  }

  async removePickupGeofence(): Promise<Result<true, NetworkError>> {
    try {
      await BackgroundGeolocation.removeGeofence('pickup');
      logger.info('removePickupGeofence: removed');
      return Result.ok(true);
    } catch (e) {
      logger.error('removePickupGeofence failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_remove_geofence_failed',
          message: 'Could not remove pickup geofence',
          cause: e,
        }),
      );
    }
  }

  async removeAllGeofences(): Promise<Result<true, NetworkError>> {
    try {
      await BackgroundGeolocation.removeGeofences();
      logger.info('removeAllGeofences: cleared');
      return Result.ok(true);
    } catch (e) {
      logger.error('removeAllGeofences failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_remove_all_geofences_failed',
          message: 'Could not clear geofences',
          cause: e,
        }),
      );
    }
  }

  /**
   * Subscribe to deduped location updates. Multiple callers register
   * against ONE underlying SDK listener; the SDK fires 2-3× per physical
   * update and we filter consecutive identical events out via a ref-keyed
   * `(lat,lng,timestamp,odometer)` tuple.
   *
   * Returns a synchronous disposer. Removing the LAST subscriber tears
   * down the underlying SDK listener so the SDK doesn't keep firing into
   * the void.
   */
  subscribeToLocation(callback: (event: BgLocationEvent) => void): () => void {
    this.locationCallbacks.add(callback);
    if (!this.locationSubscription) {
      this.locationSubscription = BackgroundGeolocation.onLocation(
        (loc: SdkLocation) => this.handleLocation(loc),
        (errorCode: number) => {
          // Some error codes (0 = "OK", 499 = "client cancelled") are
          // routine — log them at debug. Anything else is a real failure.
          if (errorCode === 0 || errorCode === 499) {
            logger.info('onLocation: routine status', {
              code: String(errorCode),
            });
          } else {
            logger.warn('onLocation: error', { code: String(errorCode) });
          }
        },
      );
    }
    return () => {
      this.locationCallbacks.delete(callback);
      if (this.locationCallbacks.size === 0 && this.locationSubscription) {
        this.locationSubscription.remove();
        this.locationSubscription = null;
        this.lastLocationKey = null;
      }
    };
  }

  /**
   * Subscribe to deduped geofence transitions. Same single-listener +
   * dedup pattern as `subscribeToLocation`. Dedup key is
   * `(identifier, action, rideId)` so back-to-back trips that re-register
   * the same `'pickup'` identifier still fan out their first fire each.
   */
  subscribeToGeofence(callback: (event: BgGeofenceEvent) => void): () => void {
    this.geofenceCallbacks.add(callback);
    if (!this.geofenceSubscription) {
      this.geofenceSubscription = BackgroundGeolocation.onGeofence(
        (geo: SdkGeofenceEvent) => this.handleGeofence(geo),
      );
    }
    return () => {
      this.geofenceCallbacks.delete(callback);
      if (this.geofenceCallbacks.size === 0 && this.geofenceSubscription) {
        this.geofenceSubscription.remove();
        this.geofenceSubscription = null;
        this.lastGeofenceKey = null;
      }
    };
  }

  async getOdometer(): Promise<Result<number, NetworkError>> {
    try {
      const meters = await BackgroundGeolocation.getOdometer();
      return Result.ok(typeof meters === 'number' ? meters : 0);
    } catch (e) {
      logger.error('getOdometer failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_get_odometer_failed',
          message: 'Could not read odometer',
          cause: e,
        }),
      );
    }
  }

  async resetOdometer(): Promise<Result<true, NetworkError>> {
    try {
      await BackgroundGeolocation.resetOdometer();
      return Result.ok(true);
    } catch (e) {
      logger.error('resetOdometer failed', e);
      return Result.err(
        new NetworkError({
          code: 'bg_geolocation_reset_odometer_failed',
          message: 'Could not reset odometer',
          cause: e,
        }),
      );
    }
  }

  /**
   * Trigger the OS permission dialog if needed. Resolves with the granted
   * authorization status.
   *
   * Note: the SDK's `requestPermission()` resolves with a numeric status
   * (`AUTHORIZATION_STATUS_*`). We translate to our string-tagged union;
   * unknown numeric values fall back to `'undetermined'` rather than
   * surfacing an error, since the OS has the final say and the caller's
   * UX already covers the "ask again" path.
   */
  async requestAuthorizationIfNeeded(): Promise<
    Result<BgPermissionStatus, AuthorizationError>
  > {
    try {
      const status = await BackgroundGeolocation.requestPermission();
      return Result.ok(this.mapAuthorizationStatus(status));
    } catch (e) {
      logger.error('requestPermission failed', e);
      return Result.err(
        new AuthorizationError({
          code: 'bg_geolocation_request_permission_failed',
          message: 'Could not request location permission',
          cause: e,
        }),
      );
    }
  }

  /**
   * Bulk-cleanup safety net. Called by AppContent's logout handler in
   * Turn 2 alongside `stop()` + `removeAllGeofences()` so the next login
   * starts with no stale event handlers.
   */
  async removeAllListeners(): Promise<void> {
    try {
      this.locationCallbacks.clear();
      this.geofenceCallbacks.clear();
      if (this.locationSubscription) {
        this.locationSubscription.remove();
        this.locationSubscription = null;
      }
      if (this.geofenceSubscription) {
        this.geofenceSubscription.remove();
        this.geofenceSubscription = null;
      }
      await BackgroundGeolocation.removeAllListeners();
    } catch (e) {
      logger.warn('removeAllListeners failed (non-fatal)', e);
    }
  }

  /* ───── Internal handlers ───── */

  private handleLocation(loc: SdkLocation): void {
    const { coords } = loc;
    const ts = Date.parse(loc.timestamp);
    const key = `${coords.latitude},${coords.longitude},${String(ts)},${String(loc.odometer)}`;
    if (key === this.lastLocationKey) return;
    this.lastLocationKey = key;

    const coordsR = Coordinates.create(coords.latitude, coords.longitude);
    if (!coordsR.ok) {
      logger.warn('handleLocation: invalid coords from SDK', {
        code: coordsR.error.code,
      });
      return;
    }

    const speed =
      typeof coords.speed === 'number' && coords.speed >= 0
        ? coords.speed
        : null;

    const event: BgLocationEvent = {
      coords: coordsR.value,
      speed,
      odometerMeters: loc.odometer ?? 0,
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
      isMoving: Boolean(loc.is_moving),
    };
    for (const cb of [...this.locationCallbacks]) {
      try {
        cb(event);
      } catch (e) {
        logger.warn('handleLocation: subscriber threw', e);
      }
    }
  }

  private handleGeofence(geo: SdkGeofenceEvent): void {
    const action =
      geo.action === 'ENTER' || geo.action === 'EXIT' ? geo.action : null;
    if (action === null) {
      logger.info('handleGeofence: ignoring unknown action', {
        action: String(geo.action),
      });
      return;
    }
    const rideIdRaw =
      geo.extras && typeof geo.extras['rideId'] === 'string'
        ? (geo.extras['rideId'] as string)
        : null;
    const rideIdR = rideIdRaw !== null ? RideId.create(rideIdRaw) : null;
    const rideId = rideIdR && rideIdR.ok ? rideIdR.value : null;

    const key = `${geo.identifier}:${action}:${rideId ?? ''}`;
    if (key === this.lastGeofenceKey) return;
    this.lastGeofenceKey = key;

    const ts = Date.parse(geo.timestamp);
    let coords: Coordinates | null = null;
    if (geo.location?.coords) {
      const c = Coordinates.create(
        geo.location.coords.latitude,
        geo.location.coords.longitude,
      );
      coords = c.ok ? c.value : null;
    }
    const event: BgGeofenceEvent = {
      identifier: geo.identifier,
      action,
      rideId,
      coords,
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
    };
    for (const cb of [...this.geofenceCallbacks]) {
      try {
        cb(event);
      } catch (e) {
        logger.warn('handleGeofence: subscriber threw', e);
      }
    }
  }

  private mapAuthorizationStatus(status: number): BgPermissionStatus {
    if (status === BackgroundGeolocation.AUTHORIZATION_STATUS_ALWAYS) {
      return 'always';
    }
    if (status === BackgroundGeolocation.AUTHORIZATION_STATUS_WHEN_IN_USE) {
      return 'when_in_use';
    }
    if (
      status === BackgroundGeolocation.AUTHORIZATION_STATUS_DENIED ||
      status === BackgroundGeolocation.AUTHORIZATION_STATUS_RESTRICTED
    ) {
      return 'denied';
    }
    return 'undetermined';
  }
}
