import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

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
 *      Turn 4b events panel is a pure rendering add. Returned but not
 *      yet consumed by an early-status view.
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
 *        - `started`                → 'on_trip'
 *        - `payment_requested` / `payment_failed` / `completed`
 *                                   → 'on_trip' (Turn 4b lands the
 *                                     terminal flip on completed)
 *        - `cancelled`              → 'online_idle' (driver re-joins
 *                                     the queue)
 *
 *   5. `arrivedAtPickup` UI flag with `onArriveAtPickup()` /
 *      `onBackToEnRoute()`. Bridges server status `'dispatched'` to the
 *      UI's `'en_route_to_pickup'` ↔ `'at_pickup'` distinction. Phase 7
 *      will auto-flip from a real geofence-entry event; in Turn 4a it's
 *      a manual button tap.
 *
 *   6. `cancel({reason, odometerMeters?})` — wraps the
 *      `useCancelRideAsDriverMutation`. The use case enforces the
 *      driver-allowed code set; `'driver_no_show'` is rejected with a
 *      `cancellation_reason_not_driver_allowed` ValidationError.
 *
 *   7. `onStartRide()` — Turn 4a stub. Logs + shows a "Coming in Turn 4b"
 *      Toast. Real `useStartRideMutation` lands alongside the
 *      `StartedView` in Turn 4b.
 *
 *   8. Terminal redirect on `cancelled`: `navigation.reset` to
 *      `DriverTabs` (mirror of `useRideMonitorViewModel`'s rider-side
 *      reset). `redirectedRef` guards against re-firing across
 *      re-renders. `completed` redirect lands in Turn 4b alongside the
 *      `CompletedView`.
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
  | 'future_status_fallback'
  | 'cancelled'
  | 'gone';

export interface UseDriverMonitorViewModel {
  readonly ride: Ride | null;
  readonly status: DriverMonitorStatus;
  readonly events: readonly TripEvent[];
  readonly arrivedAtPickup: boolean;
  readonly isCancelling: boolean;
  readonly cancelError: string | null;
  /** Flip from `'en_route_to_pickup'` → `'at_pickup'`. UI-only. */
  onArriveAtPickup: () => void;
  /** Reverse the manual arrival flip. UI-only. */
  onBackToEnRoute: () => void;
  /** Turn 4a stub: Toast "Coming in Turn 4b". Real mutation in 4b. */
  onStartRide: () => void;
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

  // ── Live ride doc ──────────────────────────────────────────────
  const subscribeRide = useCallback(
    (cb: (ride: Ride | null) => void) =>
      useCases.observeRide.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const ride = useFirestoreSubscription<Ride | null>(subscribeRide, null);

  // ── Audit-event log (primed for Turn 4b's events panel) ────────
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
  // / dispatched / on_trip). Mirror `Ride.status` into it so
  // DriverHome's tab styling and the future Earnings surface don't have
  // to re-derive from the in-progress ride query at every read.
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

  // ── Start-ride stub (Turn 4b lands the real mutation) ──────────
  const onStartRide = useCallback(() => {
    logger.warn('onStartRide invoked — Turn 4a stub (handler lands in 4b)');
    Toast.show({
      type: 'info',
      text1: 'Starting trips coming soon',
      text2: 'The Start-ride flow lands in Phase 4 turn 4b.',
      visibilityTime: 2500,
    });
  }, []);

  // ── Status derivation ──────────────────────────────────────────
  const status = useMemo<DriverMonitorStatus>(() => {
    if (ride === null) return 'loading';
    switch (ride.status) {
      case 'dispatched':
      case 'scheduled_driver_accepted':
        return arrivedAtPickup ? 'at_pickup' : 'en_route_to_pickup';
      case 'cancelled':
        return 'cancelled';
      // Late statuses land in Turn 4b. Use the fallback so the screen
      // can render a "more to come" placeholder without crashing.
      case 'started':
      case 'payment_requested':
      case 'payment_failed':
      case 'completed':
        return 'future_status_fallback';
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
  const redirectedRef = useRef<DriverMonitorStatus | null>(null);
  useEffect(() => {
    if (redirectedRef.current === status) return;
    if (status === 'cancelled') {
      redirectedRef.current = status;
      logger.info('terminal: cancelled — resetting to DriverHome');
      navigation.reset({
        index: 0,
        routes: [{ name: 'DriverTabs' }],
      });
    }
    // 'completed' / 'payment_failed' redirects land in Turn 4b alongside
    // their respective status views.
  }, [status, navigation]);

  return {
    ride,
    status,
    events,
    arrivedAtPickup,
    isCancelling: cancelMutation.isPending,
    cancelError,
    onArriveAtPickup,
    onBackToEnRoute,
    onStartRide,
    cancel,
  };
}
