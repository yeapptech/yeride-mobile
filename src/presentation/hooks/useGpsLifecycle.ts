import { useEffect, useRef } from 'react';

import type {
  BackgroundGeolocationClient,
  BgGeofenceEvent,
  BgLocationEvent,
} from '@data/services/BackgroundGeolocationClient';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { RideId } from '@domain/entities/RideId';
import type { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';
import { useBackgroundGeolocation } from '@presentation/di';
// Direct file import (not the queries barrel) to avoid a require cycle:
// the barrel re-exports `ride.queries.ts`, which imports
// `useUseCaseSubscription` from `@presentation/hooks` — and we ARE
// `@presentation/hooks`. Path-aliased deep import keeps the dependency
// graph acyclic without losing the layer-internal contract.
import { useUpdateLocationMutation } from '@presentation/queries/location.queries';
import { useGpsStore } from '@presentation/stores';
import { LOG } from '@shared/logger';
import type { FakeBackgroundGeolocationClient } from '@shared/testing';

const logger = LOG.extend('GpsLifecycle');

/**
 * Single owner of the background-geolocation SDK lifecycle.
 *
 * **AppContent-only**. Mount this hook exactly once, at the very top of
 * the React tree, inside `AppContent.tsx`. Screens and view-models read
 * GPS state via the `useGpsStore` selector hooks
 * (`useGpsCurrentLocation`, `useGpsCurrentOdometer`,
 * `useGpsLastGeofenceEvent`, `useGpsIsInsidePickupGeofence`,
 * `useGpsPermissionStatus`). Calling `useGpsLifecycle` from anywhere
 * else would re-init the SDK on every navigation — don't.
 *
 * Responsibilities (Turn 2a):
 *
 *   1. **One-shot init.** First time `enabled` flips true, call
 *      `bgGeolocation.init({ distanceFilter: 200, debug: __DEV__ })`.
 *      Idempotent — the adapter short-circuits a second call. A
 *      `useRef`-guarded flag prevents a re-init on a subsequent
 *      `false → true` (e.g. logout + re-login during the same JS
 *      runtime).
 *
 *   2. **Permission flow.** First time `enabled` flips true, call
 *      `bgGeolocation.requestAuthorizationIfNeeded()` and write the
 *      result into `useGpsStore.permissionStatus`. The OS dialog only
 *      shows on first request; subsequent calls return the granted
 *      level synchronously. A `useRef`-guarded flag prevents a re-prompt
 *      on a transient `false → true` glitch (auth flicker during hot
 *      reload).
 *
 *   3. **Start / stop.** When `enabled === true` AND permission is
 *      `'always' | 'when_in_use'`, call `bgGeolocation.start()`. When
 *      `enabled === false`, call `bgGeolocation.stop()`. Both are
 *      idempotent at the adapter level.
 *
 *   4. **Location subscription.** While mounted, subscribe to
 *      `bgGeolocation.subscribeToLocation(...)`. Each delivered event is
 *      pushed into `useGpsStore.setLocation` AND fans out to
 *      `useUpdateLocationMutation.mutate(UserLocation)` so the rider /
 *      driver's `locations/{userId}` doc receives a fresh write.
 *      Distance-based throttling is the SDK's job (`distanceFilter:
 *      200` from `init`); no JS-side debounce here. Coordinate
 *      validation happens at the adapter boundary — events that arrive
 *      with bad coords are dropped before they reach this hook.
 *
 *   5. **Geofence subscription** (Turn 2b). While mounted, subscribe to
 *      `bgGeolocation.subscribeToGeofence(...)`. Each event is pushed
 *      into `useGpsStore.setGeofenceEvent`, which derives
 *      `isInsidePickupGeofence` from `event.action`.
 *
 *   6. **Synchronous cleanup**. React effect cleanup must be
 *      synchronous (no `async function` cleanup — React silently
 *      ignores it). The cleanup function fires a fire-and-forget
 *      Promise chain `stop → removeAllGeofences → removeAllListeners`
 *      so a re-mount races cleanly against the previous teardown.
 *
 * What this hook is NOT:
 *   - The geofence registrar. Pickup-geofence registration is layered
 *     in Turn 2b via the optional `activeRideForGeofence` input — it's
 *     accepted here so the prop surface is stable across the split.
 *   - The view-model bridge. `useDriverMonitorViewModel` swaps its
 *     `arrivedAtPickup` to `useGpsIsInsidePickupGeofence()` in Turn 3,
 *     not here.
 *   - The "Open Settings" CTA driver. The hook surfaces
 *     `permissionStatus` via the store; UI work to deep-link to system
 *     settings is Phase 9 polish.
 */

export interface UseGpsLifecycleArgs {
  /**
   * Master gate for the SDK lifecycle. Compute from session + role +
   * registration-completion (`AppContent` does this) and pass in:
   *   - `true`  → init (once) + permission request (once) + start
   *   - `false` → stop, leave init in place for fast re-start on the
   *               next true.
   */
  readonly enabled: boolean;
  /**
   * The current user's id. Used to construct the `UserLocation` value
   * object before firing `useUpdateLocationMutation`. `null` when no
   * one is signed in — paired with `enabled === false` so the hook
   * skips the location-write path entirely.
   */
  readonly userId: UserId | null;
  /**
   * Turn 2b. Pass `{ rideId, pickupCoords }` when the user has an
   * `'dispatched'` ride, `null` otherwise. The hook (re-)registers the
   * single-shared `'pickup'` geofence on a non-null transition and
   * deregisters on a `null` transition. Defaults `null` so Turn 2a's
   * AppContent integration can mount the hook without committing to
   * geofences yet.
   */
  readonly activeRideForGeofence?: {
    readonly rideId: RideId;
    readonly pickupCoords: Coordinates;
  } | null;
}

/**
 * Type alias covering both the production adapter and the in-memory
 * fake. Keeps internals from caring which is wired by the Container.
 */
type GeolocationClient =
  | BackgroundGeolocationClient
  | FakeBackgroundGeolocationClient;

const DISTANCE_FILTER_METERS = 200;
const PICKUP_GEOFENCE_RADIUS_METERS = 200;

export function useGpsLifecycle(args: UseGpsLifecycleArgs): void {
  const { enabled, userId, activeRideForGeofence = null } = args;
  const bgGeolocation: GeolocationClient = useBackgroundGeolocation();
  const updateLocationMutation = useUpdateLocationMutation();

  const setPermissionStatus = useGpsStore((s) => s.setPermissionStatus);
  const setLocation = useGpsStore((s) => s.setLocation);
  const setGeofenceEvent = useGpsStore((s) => s.setGeofenceEvent);
  const setIsInsidePickupGeofence = useGpsStore(
    (s) => s.setIsInsidePickupGeofence,
  );

  // One-shot guards. Use refs (not state) so flipping them doesn't
  // re-render the consumer.
  const initRef = useRef(false);
  const permissionRequestedRef = useRef(false);

  // Latest mutator + userId carried in refs so the long-lived
  // subscription effect doesn't tear down on every fresh mutation
  // identity (TanStack Query's `useMutation` returns a new object per
  // render).
  const updateLocationMutationRef = useRef(updateLocationMutation);
  updateLocationMutationRef.current = updateLocationMutation;
  const userIdRef = useRef<UserId | null>(userId);
  userIdRef.current = userId;

  // Track the rideId of the currently-registered pickup geofence so a
  // status flip from one dispatched ride to another (rare, but
  // possible) re-registers cleanly.
  const registeredGeofenceRideIdRef = useRef<RideId | null>(null);

  /* ──────────────── 1. SDK lifecycle (init / permission / start / stop) ──────────────── */

  useEffect(() => {
    if (!enabled) {
      // Disable path: stop the SDK fire-and-forget. Don't wipe init —
      // a re-enable should pick up where we left off.
      void bgGeolocation.stop().then((r) => {
        if (!r.ok) logger.warn('stop returned error', r.error);
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      // Init once.
      if (!initRef.current) {
        const initR = await bgGeolocation.init({
          distanceFilter: DISTANCE_FILTER_METERS,
          debug: __DEV__,
        });
        if (!initR.ok) {
          logger.error('init failed', initR.error);
          return;
        }
        initRef.current = true;
      }
      if (cancelled) return;

      // Permission request once. Subsequent calls return the granted
      // level synchronously without showing the OS dialog again, but
      // we guard anyway so a brief auth flicker doesn't burn calls.
      if (!permissionRequestedRef.current) {
        const permR = await bgGeolocation.requestAuthorizationIfNeeded();
        permissionRequestedRef.current = true;
        if (!permR.ok) {
          logger.error('requestAuthorizationIfNeeded failed', permR.error);
          return;
        }
        if (cancelled) return;
        setPermissionStatus(permR.value);
        if (permR.value !== 'always' && permR.value !== 'when_in_use') {
          logger.info('permission not granted', { status: permR.value });
          return;
        }
      } else {
        // Already prompted; permission state lives in the store.
        const status = useGpsStore.getState().permissionStatus;
        if (status !== 'always' && status !== 'when_in_use') {
          return;
        }
      }
      if (cancelled) return;

      // Start. Adapter short-circuits if already running.
      const startR = await bgGeolocation.start();
      if (!startR.ok) {
        logger.error('start failed', startR.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bgGeolocation, enabled, setPermissionStatus]);

  /* ──────────────── 2. Location subscription ──────────────── */

  useEffect(() => {
    const unsubscribe = bgGeolocation.subscribeToLocation(
      (event: BgLocationEvent) => {
        setLocation(event);
        const uid = userIdRef.current;
        if (!uid) return;
        const locR = UserLocation.create({
          userId: uid,
          location: event.coords,
          speed: event.speed,
          updatedAt: new Date(event.timestampMs),
          tripTracking: null,
        });
        if (!locR.ok) {
          logger.warn('UserLocation.create failed', locR.error);
          return;
        }
        updateLocationMutationRef.current.mutate(locR.value, {
          onError: (e) => {
            logger.warn('updateLocation mutation failed', e);
          },
        });
      },
    );
    return unsubscribe;
  }, [bgGeolocation, setLocation]);

  /* ──────────────── 3. Geofence subscription ──────────────── */

  useEffect(() => {
    const unsubscribe = bgGeolocation.subscribeToGeofence(
      (event: BgGeofenceEvent) => {
        setGeofenceEvent(event);
      },
    );
    return unsubscribe;
  }, [bgGeolocation, setGeofenceEvent]);

  /* ──────────────── 4. Pickup-geofence registration (Turn 2b) ──────────────── */

  useEffect(() => {
    if (!enabled) return;
    const target = activeRideForGeofence;
    const previousRideId = registeredGeofenceRideIdRef.current;

    if (target === null) {
      if (previousRideId !== null) {
        registeredGeofenceRideIdRef.current = null;
        // Clear the inside flag at deregistration time so a stale ENTER
        // doesn't survive past the trip.
        setIsInsidePickupGeofence(false);
        void bgGeolocation.removePickupGeofence().then((r) => {
          if (!r.ok) logger.warn('removePickupGeofence error', r.error);
        });
      }
      return;
    }

    // (Re-)register. The SDK's `addGeofence` is overwrite-on-add, so a
    // rideId change replaces the previous registration cleanly.
    registeredGeofenceRideIdRef.current = target.rideId;
    void bgGeolocation
      .addPickupGeofence({
        rideId: target.rideId,
        location: target.pickupCoords,
        radiusMeters: PICKUP_GEOFENCE_RADIUS_METERS,
      })
      .then((r) => {
        if (!r.ok) logger.error('addPickupGeofence failed', r.error);
      });
  }, [
    bgGeolocation,
    enabled,
    activeRideForGeofence,
    setIsInsidePickupGeofence,
  ]);

  /* ──────────────── 5. Synchronous teardown on unmount ──────────────── */

  useEffect(() => {
    return () => {
      // Fire-and-forget. React effect cleanup must be synchronous, but
      // the chain inside resolves in order so the next session boots
      // clean.
      void (async () => {
        const stopR = await bgGeolocation.stop();
        if (!stopR.ok) logger.warn('teardown stop error', stopR.error);
        const rmR = await bgGeolocation.removeAllGeofences();
        if (!rmR.ok)
          logger.warn('teardown removeAllGeofences error', rmR.error);
        await bgGeolocation.removeAllListeners();
      })();
      registeredGeofenceRideIdRef.current = null;
    };
    // Deliberately empty dep list: we only want this on unmount, not on
    // every prop change. The other effects handle prop-driven
    // start/stop/(de)register churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
