import { useCallback, useMemo } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import { isDriver, isRider, type User } from '@domain/entities/User';
import { useUseCases } from '@presentation/di';
// Direct file import (not the queries barrel) to avoid a require cycle:
// `ride.queries.ts` imports `useUseCaseSubscription` from
// `@presentation/hooks` — and this file lives in `@presentation/hooks`.
// Bypassing the barrel keeps the dependency graph acyclic.
import {
  useInProgressDriverRideQuery,
  useInProgressRideQuery,
} from '@presentation/queries/ride.queries';

import { useFirestoreSubscription } from './useFirestoreSubscription';

/**
 * Resolves the {rideId, pickupCoords} pair that
 * `useGpsLifecycle.activeRideForGeofence` consumes — or `null` if the
 * user has no ride that should currently have a pickup geofence.
 *
 * Two-stage resolution:
 *
 *   1. **Discover** the active ride id via the role-appropriate one-shot
 *      TanStack query (`useInProgressRideQuery` for riders,
 *      `useInProgressDriverRideQuery` for drivers). Either returns the
 *      single active ride for that user, or `null`. Both hooks are
 *      called unconditionally to satisfy the Rules of Hooks; the
 *      irrelevant one stays `enabled: false`.
 *
 *   2. **Track** the ride's status live via `observeRide` so a status
 *      flip (e.g. `'dispatched' → 'started'`) reactively switches the
 *      geofence in / out without waiting on a query refetch. The
 *      subscribe closure no-ops when there's no active rideId, so the
 *      hook can be mounted at AppContent unconditionally.
 *
 * Geofence visibility window: only `'dispatched'`. The legacy app's
 * pickup geofence is registered for the same window — it's the segment
 * during which the rider is waiting at the pickup point and the driver
 * is en route. Once `'started'` fires, the rider is in the car and the
 * pickup geofence is no longer meaningful; the lifecycle hook
 * deregisters it.
 *
 * Returns:
 *   - `{ rideId, pickupCoords }` while the active ride is `'dispatched'`.
 *   - `null` in every other case (no user, no active ride, ride not yet
 *     `'dispatched'`, or already past `'dispatched'`).
 */

export interface ActiveRideForGeofence {
  readonly rideId: RideId;
  readonly pickupCoords: Coordinates;
}

export function useActiveRideForGeofence(
  user: User | null,
): ActiveRideForGeofence | null {
  const useCases = useUseCases();

  // Fan out per-role queries unconditionally; gate enable via the
  // null-userId arg shape both hooks already accept.
  const riderQuery = useInProgressRideQuery(
    user && isRider(user) ? user.id : null,
  );
  const driverQuery = useInProgressDriverRideQuery(
    user && isDriver(user) ? user.id : null,
  );

  const cachedRide: Ride | null = (() => {
    if (!user) return null;
    if (isRider(user)) return riderQuery.data ?? null;
    if (isDriver(user)) return driverQuery.data ?? null;
    return null;
  })();

  const cachedRideId = cachedRide ? cachedRide.id : null;

  // Live overlay so a status flip server-side updates the geofence
  // gate without needing a TanStack invalidation.
  const subscribe = useCallback(
    (cb: (ride: Ride | null) => void) => {
      if (!cachedRideId) {
        cb(null);
        return () => undefined;
      }
      return useCases.observeRide.execute({
        rideId: cachedRideId,
        callback: cb,
      });
    },
    [useCases, cachedRideId],
  );
  const liveRide = useFirestoreSubscription<Ride | null>(subscribe, null);

  // Prefer the live ride when it's emitted; fall back to the cached
  // query result during the brief window between the query resolving
  // and the first observeRide emission.
  const ride = liveRide ?? cachedRide;

  return useMemo<ActiveRideForGeofence | null>(() => {
    if (!ride) return null;
    if (ride.status !== 'dispatched') return null;
    return {
      rideId: ride.id,
      pickupCoords: ride.pickup.location,
    };
  }, [ride]);
}
