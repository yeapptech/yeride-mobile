import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import { UserLocation } from '@domain/entities/UserLocation';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useCancelRideAsDriverMutation,
  useRequestPaymentMutation,
  useStartRideMutation,
  useUpdateLocationMutation,
} from '@presentation/queries';
import { useDriverStatusStore } from '@presentation/stores';
import { useCurrentUserId } from '@presentation/stores/useSessionStore';
import { LOG } from '@shared/logger';

const logger = LOG.extend('DriverMonitorVM');

/**
 * View-model for `DriverMonitorScreen`.
 *
 * Composes:
 *
 *   1. Live `ObserveRide` subscription via `useFirestoreSubscription` —
 *      the source of truth for status transitions. The router enum below
 *      is derived from `Ride.status` plus a single client-side bool
 *      (`arrivedAtPickup`).
 *
 *   2. Live `ObserveTripEvents` subscription primed in Turn 4a so the
 *      future events panel is a pure rendering add. Returned but not yet
 *      consumed by an early-status view.
 *
 *   3. Foreground location push: when the screen feeds in a fresh
 *      driver coordinate, write `users/{driverId}.location`. Uses the
 *      same `lastWrittenCoordsRef` dedup pattern as
 *      `useDriverHomeViewModel`. Phase 7 swaps the foreground source for
 *      the background-aware `useGpsLifecycle`.
 *
 *   4. Mode mirror into `useDriverStatusStore`. The store flag is what
 *      DriverHome / the tabs / a future Earnings surface read; we keep
 *      it in lock-step with the live ride.
 *        - `dispatched`             → 'dispatched'
 *        - `started` / `payment_requested` / `payment_failed` /
 *          `completed`               → 'on_trip'
 *        - `cancelled`              → 'online_idle' (driver re-joins
 *                                     the queue)
 *
 *   5. `arrivedAtPickup` UI flag with `onArriveAtPickup()` /
 *      `onBackToEnRoute()`. Bridges server status `'dispatched'` to the
 *      UI's `'en_route_to_pickup'` ↔ `'at_pickup'` distinction. Phase 7
 *      will auto-flip from a real geofence-entry event; for now it's a
 *      manual button tap.
 *
 *   6. Three Cloud-Function-or-direct-write mutations:
 *
 *        - `cancel({reason, odometerMeters?})` — wraps
 *          `useCancelRideAsDriverMutation` (driver-allowed code set
 *          enforced by the use case; `'driver_no_show'` is rejected
 *          with `cancellation_reason_not_driver_allowed`).
 *        - `onStartRide()` — wraps `useStartRideMutation`. The view-
 *          model derives a stub odometer (`pickupTiming.odometerMeters
 *          ?? 0` + 1) so the screen stays prop-thin. Phase 7 swaps the
 *          derivation for a real GPS-derived odometer in this one
 *          place.
 *        - `requestPayment()` — wraps `useRequestPaymentMutation`. Same
 *          stub-odometer derivation. Routes through the `completeTrip`
 *          Cloud Function for server-side fare math.
 *
 *   7. Terminal redirects on `cancelled` AND `completed`: both fire
 *      `navigation.reset({ index: 0, routes: [{ name: 'DriverTabs' }] })`.
 *      `payment_failed` is intentionally NOT a terminal redirect — the
 *      driver stays on the screen and sees the failure card with the
 *      "Close trip" CTA. `redirectedRef` guards against re-firing
 *      across re-renders.
 *
 * Driver location is passed in by the screen (which owns
 * `useCurrentLocation`) — same testability seam DriverDispatch uses.
 * Tests can drive the VM with synthetic coordinates without an
 * `expo-location` mock.
 */

export type DriverMonitorStatus =
  | 'loading'
  | 'en_route_to_pickup'
  | 'at_pickup'
  | 'started'
  | 'payment_requested'
  | 'completed'
  | 'payment_failed'
  | 'cancelled'
  | 'gone';

export interface UseDriverMonitorViewModel {
  readonly ride: Ride | null;
  readonly status: DriverMonitorStatus;
  readonly events: readonly TripEvent[];
  readonly arrivedAtPickup: boolean;
  readonly isCancelling: boolean;
  readonly cancelError: string | null;
  readonly isStarting: boolean;
  readonly startError: string | null;
  readonly isRequestingPayment: boolean;
  readonly requestPaymentError: string | null;
  /** Flip from `'en_route_to_pickup'` → `'at_pickup'`. UI-only. */
  onArriveAtPickup: () => void;
  /** Reverse the manual arrival flip. UI-only. */
  onBackToEnRoute: () => void;
  /**
   * Persist server status `dispatched → started`. Returns `true` on
   * success. Surface errors via `startError`.
   *
   * Stub odometer note: until Phase 7 wires real GPS-derived odometer,
   * the VM uses a synthetic `pickupTiming.odometerMeters ?? 0` + 1 so
   * the entity's monotonicity check passes. The legacy backend
   * tolerated missing odometer here; Phase 7 swaps in real readings.
   */
  onStartRide: () => Promise<boolean>;
  /**
   * Persist server status `started → payment_requested` via the
   * `completeTrip` Cloud Function. Returns `true` on success. Surface
   * errors via `requestPaymentError`. Same stub-odometer note as
   * `onStartRide`.
   */
  requestPayment: () => Promise<boolean>;
  /** Cancel the ride with the driver-allowed reason. */
  cancel: (args: {
    reason: CancellationReason;
    odometerMeters?: number;
  }) => Promise<boolean>;
}

export interface DriverMonitorViewModelArgs {
  readonly rideId: RideId;
  readonly driverLocation: Coordinates | null;
}

export function useDriverMonitorViewModel(
  args: DriverMonitorViewModelArgs,
): UseDriverMonitorViewModel {
  const { rideId, driverLocation } = args;
  const useCases = useUseCases();
  const navigation = useNavigation<DriverStackNavigation>();
  const driverId = useCurrentUserId();
  const setMode = useDriverStatusStore((s) => s.setMode);
  const updateLocationMutation = useUpdateLocationMutation();
  const cancelMutation = useCancelRideAsDriverMutation();
  const startMutation = useStartRideMutation();
  const requestPaymentMutation = useRequestPaymentMutation();

  // ── Live ride doc ──────────────────────────────────────────────
  const subscribeRide = useCallback(
    (cb: (ride: Ride | null) => void) =>
      useCases.observeRide.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const ride = useFirestoreSubscription<Ride | null>(subscribeRide, null);

  // ── Audit-event log (primed for the future events panel) ───────
  const subscribeEvents = useCallback(
    (cb: (events: readonly TripEvent[]) => void) =>
      useCases.observeTripEvents.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const events = useFirestoreSubscription<readonly TripEvent[]>(
    subscribeEvents,
    [],
  );

  // ── arrivedAtPickup UI flag ────────────────────────────────────
  const [arrivedAtPickup, setArrivedAtPickup] = useState<boolean>(false);
  const onArriveAtPickup = useCallback(() => setArrivedAtPickup(true), []);
  const onBackToEnRoute = useCallback(() => setArrivedAtPickup(false), []);

  // Reset the flag whenever the underlying ride leaves `dispatched`. If
  // the trip transitions to `started` server-side and then somehow rolls
  // back (it doesn't, but defensive), we want a clean slate.
  useEffect(() => {
    if (ride && ride.status !== 'dispatched') {
      setArrivedAtPickup(false);
    }
  }, [ride]);

  // ── Driver-mode mirror ─────────────────────────────────────────
  // The store tracks the driver's high-level mode (offline / online_idle
  // / dispatched / on_trip). Mirror `Ride.status` into it so DriverHome's
  // tab styling and the future Earnings surface don't have to re-derive
  // from the in-progress ride query at every read.
  useEffect(() => {
    if (!ride) return;
    switch (ride.status) {
      case 'dispatched':
      case 'scheduled_driver_accepted':
        setMode('dispatched');
        return;
      case 'started':
      case 'payment_requested':
      case 'payment_failed':
      case 'completed':
        setMode('on_trip');
        return;
      case 'cancelled':
        setMode('online_idle');
        return;
      // 'awaiting_driver' / 'scheduled' shouldn't reach this VM (the driver
      // wouldn't be on this screen for them) — fall through and don't touch
      // the mode.
      default:
        return;
    }
  }, [ride, setMode]);

  // ── Foreground location push ──────────────────────────────────
  // Same dedup-ref pattern as `useDriverHomeViewModel`. The screen drives
  // the source coordinate via `useCurrentLocation`; we only fire when
  // it actually changes.
  const lastWrittenCoordsRef = useRef<Coordinates | null>(null);
  useEffect(() => {
    if (!driverId || !driverLocation) return;
    if (
      lastWrittenCoordsRef.current &&
      lastWrittenCoordsRef.current.equals(driverLocation)
    ) {
      return;
    }
    const locationR = UserLocation.create({
      userId: driverId,
      location: driverLocation,
      speed: null,
      updatedAt: new Date(),
      tripTracking: null,
    });
    if (!locationR.ok) {
      logger.warn('updateLocation: build failed', locationR.error);
      return;
    }
    lastWrittenCoordsRef.current = driverLocation;
    updateLocationMutation.mutate(locationR.value, {
      onError: (e: unknown) => {
        logger.warn('updateLocation: mutation failed', e);
      },
    });
  }, [driverId, driverLocation, updateLocationMutation]);

  // ── Stub odometer derivation ───────────────────────────────────
  // Phase 7 replaces this single helper with a real GPS-derived reading
  // from `useGpsLifecycle`. Centralizing it here keeps the screen prop-
  // thin and gives us a single edit-site when the real source lands.
  //
  // The +1 ensures monotonicity: the entity's `requestPayment` rejects
  // an odometer < `pickupTiming.odometerMeters`; using `pickup + 1` is
  // a deterministic, always-valid stub. Real distance during the trip
  // will be measured by Phase 7's GPS pipeline.
  const stubOdometerMeters = (currentRide: Ride | null): number => {
    const pickup = currentRide?.pickupTiming.odometerMeters ?? 0;
    return pickup + 1;
  };

  // ── Cancel ─────────────────────────────────────────────────────
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancel = useCallback(
    async (cancelArgs: {
      reason: CancellationReason;
      odometerMeters?: number;
    }): Promise<boolean> => {
      setCancelError(null);
      try {
        await cancelMutation.mutateAsync({
          rideId,
          reason: cancelArgs.reason,
          ...(cancelArgs.odometerMeters !== undefined
            ? { odometerMeters: cancelArgs.odometerMeters }
            : {}),
        });
        // The live subscription will deliver the `cancelled` snapshot;
        // the terminal-redirect effect below handles the navigation.
        return true;
      } catch (e: unknown) {
        logger.error('cancel: mutation failed', e);
        setCancelError(
          e instanceof Error
            ? e.message
            : 'Could not cancel — please try again.',
        );
        return false;
      }
    },
    [cancelMutation, rideId],
  );

  // ── Start ride ─────────────────────────────────────────────────
  const [startError, setStartError] = useState<string | null>(null);
  const onStartRide = useCallback(async (): Promise<boolean> => {
    setStartError(null);
    try {
      await startMutation.mutateAsync({
        rideId,
        odometerMeters: stubOdometerMeters(ride),
      });
      return true;
    } catch (e: unknown) {
      logger.error('startRide: mutation failed', e);
      setStartError(
        e instanceof Error
          ? e.message
          : 'Could not start the trip — please try again.',
      );
      return false;
    }
  }, [startMutation, rideId, ride]);

  // ── Request payment ────────────────────────────────────────────
  const [requestPaymentError, setRequestPaymentError] = useState<string | null>(
    null,
  );
  const requestPayment = useCallback(async (): Promise<boolean> => {
    setRequestPaymentError(null);
    try {
      await requestPaymentMutation.mutateAsync({
        rideId,
        odometerMeters: stubOdometerMeters(ride),
      });
      return true;
    } catch (e: unknown) {
      logger.error('requestPayment: mutation failed', e);
      setRequestPaymentError(
        e instanceof Error
          ? e.message
          : 'Could not request payment — please try again.',
      );
      return false;
    }
  }, [requestPaymentMutation, rideId, ride]);

  // ── Status derivation ──────────────────────────────────────────
  const status = useMemo<DriverMonitorStatus>(() => {
    if (ride === null) return 'loading';
    switch (ride.status) {
      case 'dispatched':
      case 'scheduled_driver_accepted':
        return arrivedAtPickup ? 'at_pickup' : 'en_route_to_pickup';
      case 'started':
        return 'started';
      case 'payment_requested':
        return 'payment_requested';
      case 'completed':
        return 'completed';
      case 'payment_failed':
        return 'payment_failed';
      case 'cancelled':
        return 'cancelled';
      // 'awaiting_driver' / 'scheduled' shouldn't reach this VM — if
      // they do (e.g. the rider cancelled mid-flight before dispatch
      // committed), surface 'gone' so the screen can wind down cleanly.
      default:
        return 'gone';
    }
  }, [ride, arrivedAtPickup]);

  // ── Terminal redirect ──────────────────────────────────────────
  // Use a ref to remember whether we already dispatched a redirect so a
  // re-render with the same terminal status doesn't fire navigation
  // twice. Mirrors `useRideMonitorViewModel`.
  //
  // Both `cancelled` and `completed` are terminal: the trip is done
  // and we send the driver back to the queue. `payment_failed` is
  // intentionally NOT redirected — the driver stays on the failure
  // card and taps "Close trip" themselves.
  const redirectedRef = useRef<DriverMonitorStatus | null>(null);
  useEffect(() => {
    if (redirectedRef.current === status) return;
    if (status === 'cancelled' || status === 'completed') {
      redirectedRef.current = status;
      logger.info(`terminal: ${status} — resetting to DriverTabs`);
      navigation.reset({
        index: 0,
        routes: [{ name: 'DriverTabs' }],
      });
    }
  }, [status, navigation]);

  return {
    ride,
    status,
    events,
    arrivedAtPickup,
    isCancelling: cancelMutation.isPending,
    cancelError,
    isStarting: startMutation.isPending,
    startError,
    isRequestingPayment: requestPaymentMutation.isPending,
    requestPaymentError,
    onArriveAtPickup,
    onBackToEnRoute,
    onStartRide,
    requestPayment,
    cancel,
  };
}
