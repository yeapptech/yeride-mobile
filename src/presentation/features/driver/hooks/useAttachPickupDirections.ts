import { useEffect, useRef } from 'react';

import type { Ride } from '@domain/entities/Ride';
import { useUseCases } from '@presentation/di';
import { useGpsCurrentLocation } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('AttachPickupDirections');

/** Max driver→pickup route computations per ride before giving up (best-effort). */
const MAX_ATTACH_ATTEMPTS = 3;

/**
 * Post-claim pickup-directions hook for the driver monitor.
 *
 * The claim (`DispatchRide` / `BeginScheduledRide`) flips a ride to
 * `dispatched` WITHOUT directions so accept/decline paints instantly and
 * only the winning driver spends a Google Routes quota unit. Once that
 * driver lands on the monitor, this hook computes the driver→pickup route
 * (origin = live GPS) and attaches it to the ride doc, filling the pickup
 * polyline + ETA that the rider's DispatchedView and the driver's
 * EnRouteToPickupView render.
 *
 * Fires once per ride: guarded by `ride.status === 'dispatched'`,
 * `ride.pickup.directions === null`, an available live coordinate, and a
 * per-rideId ref. On a no-route attempt (compute failure or empty result) the
 * ref is cleared so a later GPS emit retries — up to `MAX_ATTACH_ATTEMPTS`,
 * after which it gives up so a persistent Routes failure doesn't recompute
 * (and burn a quota unit) on every GPS tick. On success the attached
 * directions make the guard short-circuit, so it never recomputes.
 */
export function useAttachPickupDirections(ride: Ride | null): void {
  const useCases = useUseCases();
  const driverCoords = useGpsCurrentLocation();
  const attemptedRideRef = useRef<string | null>(null);
  const failuresRef = useRef<{ rideId: string; count: number }>({
    rideId: '',
    count: 0,
  });

  useEffect(() => {
    if (!ride) return;
    if (ride.status !== 'dispatched') return;
    if (ride.pickup.directions !== null) return;
    if (!driverCoords) return;

    const rideKey = String(ride.id);
    if (attemptedRideRef.current === rideKey) return;
    attemptedRideRef.current = rideKey;
    if (failuresRef.current.rideId !== rideKey) {
      failuresRef.current = { rideId: rideKey, count: 0 };
    }

    // No abort-on-cleanup: the effect re-runs on every GPS tick, and the
    // latch above already dedupes by rideId. Letting an in-flight attempt
    // run to completion (writing directions for THIS ride) is always
    // correct — cancelling it would leave the latch set with nothing
    // persisted, so directions would never attach until the rideId changed.
    void (async () => {
      const routesR = await useCases.computeRoutes.execute({
        origin: { coordinates: driverCoords },
        destination: { coordinates: ride.pickup.location },
      });
      const route = routesR.ok ? routesR.value[0] : undefined;
      if (!route) {
        if (!routesR.ok) {
          logger.warn('computeRoutes (pickup) failed', routesR.error);
        }
        // No usable route this attempt. Clear the latch so the next GPS emit
        // retries — but only up to MAX_ATTACH_ATTEMPTS, then give up (pickup
        // directions are best-effort; the ride is operable without them) so a
        // persistent failure doesn't recompute on every GPS tick.
        failuresRef.current.count += 1;
        if (failuresRef.current.count < MAX_ATTACH_ATTEMPTS) {
          attemptedRideRef.current = null;
        } else {
          logger.warn('attachPickupDirections: giving up after max attempts', {
            rideId: rideKey,
          });
        }
        return;
      }
      const attachR = await useCases.attachPickupDirections.execute({
        rideId: ride.id,
        directions: route,
      });
      // The rider may have cancelled in the window between claim and attach
      // (ride no longer 'dispatched') → illegal transition. Best-effort:
      // log at warn, don't escalate.
      if (!attachR.ok) {
        logger.warn('attachPickupDirections failed', attachR.error);
      }
    })();
  }, [ride, driverCoords, useCases]);
}
