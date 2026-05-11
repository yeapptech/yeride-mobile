// v5.x packaging quirk: `react-native-background-geolocation/src/index.d.ts`
// has `export * from '@transistorsoft/background-geolocation-types'` but
// the sibling `src/index.js` does NOT mirror that re-export — its only
// runtime export is the default class. Named imports for the enums
// (`DesiredAccuracy`, `LogLevel`, `AuthorizationStatus`) come back
// `undefined` on a device, even though TypeScript sees them as exported.
// Source from the types package directly (already a transitive dep of
// the SDK; its `dist/index.js` emits real `__exportStar` runtime values
// for each enum). Switch back to the SDK if/when their packaging is fixed.
import {
  AuthorizationStatus,
  DesiredAccuracy,
  LogLevel,
} from '@transistorsoft/background-geolocation-types';
import BackgroundGeolocation, {
  type GeofenceEvent as SdkGeofenceEvent,
  type Location as SdkLocation,
  type State as SdkState,
} from 'react-native-background-geolocation';

import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { AuthorizationError, NetworkError } from '@domain/errors';
import type {
  BackgroundGeolocationClientInitArgs,
  BackgroundGeolocationService,
  BgGeofenceEvent,
  BgLocationEvent,
  BgPermissionStatus,
} from '@domain/services';
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

/* ───── Adapter ───── */

export class BackgroundGeolocationClient implements BackgroundGeolocationService {
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
    // 2026-05-07 — Android-emulator workaround, v2.
    //
    // Background:
    //   v4.19.4's `rapidActivityLaunch` kill loop is gone in v5 (the
    //   v5.0.2 SDK changelog refactored Android Activity-lifecycle
    //   management to be SDK-internal). HOWEVER, v5 ships
    //   `tslocationmanager:4.1.5` which has a SEPARATE regression:
    //   `buildLocationRequest` passes the SDK's internal
    //   `DesiredAccuracy` sentinel (`-1` for `High`) directly to GMS's
    //   `LocationRequest.setPriority()` instead of translating it into
    //   `Priority.PRIORITY_HIGH_ACCURACY` (100). On
    //   `play-services-location:21.x`, `setPriority` strictly validates
    //   and throws `IllegalArgumentException: priority -1 must be a
    //   Priority.PRIORITY_* constant` from `TSLocationManagerActivity.onCreate`,
    //   killing the app the first time `start()` triggers a settings refine.
    //
    //   We attempted three workarounds: (1) `ext { tslocationmanagerVersion =
    //   "4.1.4" }` — Gradle still resolved 4.1.5; (2) `subprojects {
    //   configurations.all { resolutionStrategy.force ... } }` — same
    //   outcome; (3) directly patching the SDK's own android/build.gradle
    //   to hard-code `'4.1.4'` — STILL resolved 4.1.5 in the merged-
    //   manifest report. Something in the Expo SDK 55 build graph
    //   (likely `expoAutolinking.useExpoVersionCatalog()`) overrides
    //   our pin in a way we couldn't reach. File an issue with
    //   Transistor about the 4.1.5 priority-translation regression.
    //
    // Mitigation: skip native init in __DEV__. The kill loop's gone
    // (real win from v5), but `start()` would still crash on the
    // priority bug if the SDK actually initialized. Production
    // builds — different keystore + obfuscation map — should be
    // tested on a real device; if 4.1.5 ships there too, escalate.
    //
    // To re-enable real init for testing on a real device: comment
    // out the early-return below.
    if (__DEV__) {
      this.initialized = true;
      logger.warn(
        'init: skipping native init in __DEV__ (Android emulator ' +
          'tslocationmanager:4.1.5 setPriority(-1) crash workaround). ' +
          'GPS/geofence features disabled until tested on a real device.',
      );
      return Result.ok(true);
    }
    try {
      // v5.x: SDK migrated from flat-config to compound-config (groups
      // related options under geolocation/app/activity/logger/persistence
      // sub-objects). Flat config is still accepted at runtime for
      // backward compat but only the compound shape is in the TS type
      // defs. See help/MIGRATION-GUIDE-5.0.0.md.
      await BackgroundGeolocation.ready({
        // Force re-apply config on every launch. Without this, persisted
        // config from a prior install can mask `stopOnTerminate: true` —
        // legacy gpsLocation.js comment.
        reset: true,
        geolocation: {
          desiredAccuracy: DesiredAccuracy.High,
          distanceFilter: args.distanceFilter,
          // How long the SDK waits before declaring the device stationary
          // (5s = legacy default).
          stopTimeout: 5,
          locationAuthorizationRequest: 'Always',
        },
        activity: {
          // Disable the SDK's internal MotionActivityCheck loop. On the
          // Android emulator (no real GPS hardware) this loop is what
          // drives the worst-case TSLocationManagerActivity launch rate;
          // disabling it cuts the rate ~8× (32/s → 4/s) — still enough
          // to trip rapidActivityLaunch eventually, but worth keeping
          // because the rate without these flags is dramatically worse.
          // Re-enable at trip-start time via `changePace(true)` if
          // motion-activity classification is needed (we don't use it).
          disableMotionActivityUpdates: true,
          disableStopDetection: true,
        },
        app: {
          backgroundPermissionRationale: {
            title:
              'Allow YeRide Next to access your location even when the app is in the background.',
            message:
              'YeRide Next uses location data to track trips, estimate arrival times, and calculate distances traveled. This data is required for the trip-tracking and pickup-area features.',
            positiveAction: 'Enable "{backgroundPermissionOptionLabel}"',
            negativeAction: 'Cancel',
          },
          // CRITICAL: stop tracking when the user force-quits the app, and
          // do NOT auto-start on device boot. Matches legacy contract.
          stopOnTerminate: true,
          startOnBoot: false,
        },
        logger: {
          debug: args.debug ?? false,
          logLevel: args.debug ? LogLevel.Verbose : LogLevel.Error,
        },
        persistence: {
          locationsOrderDirection: 'DESC',
          maxDaysToPersist: 14,
        },
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
    if (__DEV__) return Result.ok(true);
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
    if (__DEV__) return Result.ok(true);
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
    if (__DEV__) return Result.ok(true);
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
    if (__DEV__) return Result.ok(true);
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
    if (__DEV__) return Result.ok(true);
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
    if (__DEV__) {
      // No-op in dev — SDK is not initialized. Track the callback so the
      // disposer contract still holds, but never wire it to a real SDK
      // listener.
      this.locationCallbacks.add(callback);
      return () => {
        this.locationCallbacks.delete(callback);
      };
    }
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
            // Phase 9 turn 9: SDK error codes (1=permission denied,
            // 2=network unavailable, 408=timeout, etc.) are platform-
            // level failures of the location pipeline. Construct an
            // Error carrying the numeric code in the message so
            // Crashlytics groups non-fatals per code (Turn 4's
            // NavRouteStatus pattern). The original meta `{code}` is
            // a plain object — without the constructed wrapper the
            // rawMeta channel's `extractError` returns null and the
            // recordError fan-out skips this site.
            logger.error(
              'onLocation: error',
              new Error(
                `bg_geolocation_onlocation_error: code=${String(errorCode)}`,
              ),
            );
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
    if (__DEV__) {
      this.geofenceCallbacks.add(callback);
      return () => {
        this.geofenceCallbacks.delete(callback);
      };
    }
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
    if (__DEV__) return Result.ok('always');
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
      // v5.x: `removeAllListeners` is a runtime alias that calls
      // `removeListeners`, but only `removeListeners` is in the type defs.
      await BackgroundGeolocation.removeListeners();
    } catch (e) {
      // stays warn — best-effort cleanup. The next session's adapter
      // instance is fresh, so listener leakage doesn't carry forward;
      // a Crashlytics non-fatal here would be noise without a
      // corresponding user-visible failure.
      logger.warn('removeAllListeners failed (non-fatal)', e);
    }
  }

  /* ───── Internal handlers ───── */

  private handleLocation(loc: SdkLocation): void {
    const { coords } = loc;
    // v5.x: `loc.timestamp` is `string | number` in the type defs (new
    // `PersistenceConfig.timestampFormat: 'epoch'` option). We never set
    // that option so we always receive ISO-8601 strings, but narrow
    // defensively in case the SDK or a future config flips the shape.
    const ts =
      typeof loc.timestamp === 'number'
        ? loc.timestamp
        : Date.parse(loc.timestamp);
    const key = `${coords.latitude},${coords.longitude},${String(ts)},${String(loc.odometer)}`;
    if (key === this.lastLocationKey) return;
    this.lastLocationKey = key;

    const coordsR = Coordinates.create(coords.latitude, coords.longitude);
    if (!coordsR.ok) {
      // Phase 9 turn 9: SDK contract violation — the platform's GPS
      // subsystem fed us NaN or out-of-range lat/lng. Extremely rare
      // in field but if it fires, it's a platform-level bug worth
      // surfacing in Crashlytics. The `ValidationError` from
      // `Coordinates.create` is already a real Error (extends
      // DomainError extends Error) — pass it directly so the rawMeta
      // channel fans it out with the validation code on the
      // reference. No constructed-Error wrapper needed.
      logger.error('handleLocation: invalid coords from SDK', coordsR.error);
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
        // Phase 9 turn 9: a synchronously-throwing subscriber is a
        // domain-side bug — the registered callback (a hook or
        // view-model effect) threw inside the SDK fan-out. The
        // throwing subscriber doesn't necessarily know its callback
        // was firing into the SDK, so the exception goes nowhere
        // useful without telemetry. `e` IS a real Error here, so
        // flip-only — the rawMeta channel passes the reference
        // directly to `recordError`. The fan-out loop continues
        // (resilience: one bad subscriber doesn't take down the
        // others).
        logger.error('handleLocation: subscriber threw', e);
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

    // v5.x: same narrowing as `handleLocation` — `geo.timestamp` is
    // `string | number` in the type defs.
    const ts =
      typeof geo.timestamp === 'number'
        ? geo.timestamp
        : Date.parse(geo.timestamp);
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
        // Phase 9 turn 9: same shape as `handleLocation: subscriber
        // threw` — domain-side bug, real Error, flip-only. Fan-out
        // loop continues so other subscribers still receive the
        // event.
        logger.error('handleGeofence: subscriber threw', e);
      }
    }
  }

  private mapAuthorizationStatus(status: number): BgPermissionStatus {
    // v5.x: compound enum `AuthorizationStatus` replaces the legacy
    // `AUTHORIZATION_STATUS_*` flat constants in the type defs (the
    // flat names still exist as runtime aliases on the default export).
    if (status === AuthorizationStatus.Always) {
      return 'always';
    }
    if (status === AuthorizationStatus.WhenInUse) {
      return 'when_in_use';
    }
    if (
      status === AuthorizationStatus.Denied ||
      status === AuthorizationStatus.Restricted
    ) {
      return 'denied';
    }
    return 'undetermined';
  }
}
