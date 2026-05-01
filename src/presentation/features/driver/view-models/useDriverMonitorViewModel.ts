import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import { UserLocation } from '@domain/entities/UserLocation';
import { useNavigationSdk, useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useCancelRideAsDriverMutation,
  useRequestPaymentMutation,
  useStartRideMutation,
  useUpdateLocationMutation,
} from '@presentation/queries';
import {
  useDriverStatusStore,
  useGpsCurrentOdometer,
  useGpsIsInsidePickupGeofence,
} from '@presentation/stores';
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
 *   2. Live `ObserveTripEvents` subscription primed so the future
 *      events panel (Phase 9 polish) is a pure rendering add. Returned
 *      but not yet consumed by any status view.
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
 *   5. `arrivedAtPickup` UI flag, derived (Phase 7 turn 3) from
 *      `useGpsIsInsidePickupGeofence() || manualOverride`. The geofence
 *      half is event-driven by `useGpsLifecycle`'s pickup-geofence
 *      registration (mounted at AppContent). The manual override
 *      remains for resilience when GPS reports outside the area
 *      despite the driver having arrived (cellular dead zones, GPS
 *      drift). `onArriveAtPickup()` flips the override; once set it
 *      sticks until `'dispatched'` is left, so a transient EXIT
 *      doesn't bounce the UI back to en-route mid-pickup. Bridges
 *      server status `'dispatched'` to the UI's
 *      `'en_route_to_pickup'` ↔ `'at_pickup'` distinction (no server
 *      write — UI-only).
 *
 *   6. Three Cloud-Function-or-direct-write mutations:
 *
 *        - `cancel({reason, odometerMeters?})` — wraps
 *          `useCancelRideAsDriverMutation` (driver-allowed code set
 *          enforced by the use case; `'driver_no_show'` is rejected
 *          with `cancellation_reason_not_driver_allowed`).
 *        - `onStartRide()` — wraps `useStartRideMutation`. The
 *          odometer is read from `useGpsCurrentOdometer()` (Phase 7
 *          turn 3), set by `useGpsLifecycle`'s location subscription
 *          per SDK delivery. Replaces the legacy
 *          `pickupTiming.odometerMeters ?? 0` + 1 stub.
 *        - `requestPayment()` — wraps `useRequestPaymentMutation`.
 *          Same `useGpsCurrentOdometer()` read. Routes through the
 *          `completeTrip` Cloud Function for server-side fare math
 *          (now against real GPS distance).
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
   * Odometer source (Phase 7 turn 3): `useGpsCurrentOdometer()`, fed
   * by `useGpsLifecycle`'s SDK location subscription. Defaults to `0`
   * before the first delivery — the entity accepts that value at
   * start (any non-negative reading is a valid first-odometer).
   */
  onStartRide: () => Promise<boolean>;
  /**
   * Persist server status `started → payment_requested` via the
   * `completeTrip` Cloud Function. Returns `true` on success. Surface
   * errors via `requestPaymentError`. Same `useGpsCurrentOdometer()`
   * source as `onStartRide`.
   */
  requestPayment: () => Promise<boolean>;
  /** Cancel the ride with the driver-allowed reason. */
  cancel: (args: {
    reason: CancellationReason;
    odometerMeters?: number;
  }) => Promise<boolean>;
  /**
   * Launch the Google Navigation SDK turn-by-turn screen for the
   * current trip leg (Phase 8 turn 2). Reads `ride.status` to pick the
   * pickup vs. dropoff leg, runs the SDK's `init()` (showing the terms
   * dialog on first launch), and on success navigates to
   * `'DriverNavigation'` with the leg's destination + (for dropoff)
   * route token + avoid-tolls preference. Surface errors via a Toast
   * — no external-Maps fallback this phase.
   *
   * No-op on statuses where navigation isn't applicable (e.g.
   * `'completed'`, `'cancelled'`).
   */
  onLaunchNavigation: () => Promise<void>;
  /** True while `onLaunchNavigation`'s init/terms chain is in flight. */
  readonly isLaunchingNavigation: boolean;
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
  const navigationSdk = useNavigationSdk();
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

  // ── arrivedAtPickup (Phase 7 turn 3) ───────────────────────────
  // The display flag is now derived: `(geofence inside) || (manual
  // override)`. `useGpsLifecycle` (mounted at AppContent) registers a
  // pickup geofence on `'dispatched'` and pushes ENTER / EXIT events
  // into `useGpsStore`; this VM reads `useGpsIsInsidePickupGeofence()`
  // for the GPS half. The manual override remains for resilience —
  // GPS drift, cellular dead zones, or the geofence reporting
  // outside-when-actually-arrived. Once the driver taps the manual
  // button, the override sticks even if GPS subsequently reports
  // outside (so a transient EXIT during pickup-area tasks doesn't
  // bounce the UI back to en-route).
  //
  // The override is reset when the ride leaves `'dispatched'` so a
  // fresh trip (or a re-render after a status flip) starts clean.
  const fromGps = useGpsIsInsidePickupGeofence();
  const [manualOverride, setManualOverride] = useState<boolean>(false);
  const arrivedAtPickup = fromGps || manualOverride;
  const onArriveAtPickup = useCallback(() => setManualOverride(true), []);
  const onBackToEnRoute = useCallback(() => setManualOverride(false), []);

  useEffect(() => {
    if (ride && ride.status !== 'dispatched') {
      setManualOverride(false);
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

  // ── Real odometer (Phase 7 turn 3) ─────────────────────────────
  // `useGpsLifecycle` (mounted at AppContent) drives
  // `useGpsStore.currentOdometerMeters` from the SDK's per-delivery
  // location events. We read it via the cheap selector hook and pass
  // it to `Start ride` / `Request payment` mutations at the moment of
  // tap. The entity's monotonicity check (`requestPayment` requires
  // `odometerMeters >= pickupTiming.odometerMeters`) now runs against
  // real GPS data instead of the legacy `pickup + 1` stub.
  //
  // Staleness note: the value is the most-recent SDK delivery, which
  // is gated by `distanceFilter: 200` (≤200m / ~30s old). We
  // deliberately don't call `bgGeolocation.getOdometer()` at click
  // time to avoid an `await` on the user-facing tap; field telemetry
  // can revisit if the staleness matters (Phase 9 polish).
  const currentOdometerMeters = useGpsCurrentOdometer();

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
        odometerMeters: currentOdometerMeters,
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
  }, [startMutation, rideId, currentOdometerMeters]);

  // ── Request payment ────────────────────────────────────────────
  const [requestPaymentError, setRequestPaymentError] = useState<string | null>(
    null,
  );
  const requestPayment = useCallback(async (): Promise<boolean> => {
    setRequestPaymentError(null);
    try {
      await requestPaymentMutation.mutateAsync({
        rideId,
        odometerMeters: currentOdometerMeters,
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
  }, [requestPaymentMutation, rideId, currentOdometerMeters]);

  // ── Launch Navigation (Phase 8 turn 2) ─────────────────────────
  // The connector hook (mounted by DriverMonitorScreen) has already
  // pushed the SDK controller into the adapter by the time this
  // callback fires. We run the legacy-faithful init sequence in the
  // PARENT screen — `init()` first, with a terms-dialog retry on
  // first launch — so the navigation screen, when it pushes, sees
  // an already-alive session. This sidesteps the legacy
  // `getCurrentActivity()` null-after-`<NavigationView/>` quirk on
  // Android.
  //
  // Errors surface as Toast warnings; no external-Maps fallback this
  // phase (see Phase 8 kickoff "out" list).
  const [isLaunchingNavigation, setIsLaunchingNavigation] = useState(false);
  const onLaunchNavigation = useCallback(async (): Promise<void> => {
    if (isLaunchingNavigation) return;
    if (!ride) return;

    // Pick leg + build route param. Defensive guard on statuses where
    // navigation isn't applicable: silently no-op.
    const legParam = buildLegParam(ride);
    if (legParam === null) {
      logger.debug('onLaunchNavigation: ride status not eligible', {
        status: ride.status,
      });
      return;
    }

    setIsLaunchingNavigation(true);
    try {
      // Run the init dance against the live adapter. The connector
      // hook ensured the SDK controller is connected.
      let initR = await navigationSdk.init();
      if (!initR.ok && initR.error.code === 'navigation_terms_not_accepted') {
        const termsR = await navigationSdk.showTermsAndConditionsDialog();
        if (!termsR.ok) {
          logger.warn('terms dialog failed', termsR.error);
          Toast.show({
            type: 'error',
            text1: 'Could not show terms dialog. Please try again.',
          });
          return;
        }
        if (!termsR.value.accepted) {
          // User declined. Don't badger them with a Toast — declining
          // is a deliberate choice.
          logger.info('terms declined by user');
          return;
        }
        initR = await navigationSdk.init();
      }
      if (!initR.ok) {
        logger.warn('navigation init failed', initR.error);
        Toast.show({
          type: 'error',
          text1: 'Navigation unavailable',
          text2:
            initR.error.code === 'navigation_api_not_authorized'
              ? 'This device is not authorized for navigation.'
              : 'Please check your connection and try again.',
        });
        return;
      }

      navigation.navigate('DriverNavigation', legParam);
    } finally {
      setIsLaunchingNavigation(false);
    }
  }, [isLaunchingNavigation, ride, navigationSdk, navigation]);

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
    onLaunchNavigation,
    isLaunchingNavigation,
  };
}

/* ───── Helpers ───── */

/**
 * Build the route param for `DriverNavigation`, picking pickup vs.
 * dropoff based on `ride.status`. Returns null when navigation is not
 * applicable (e.g. completed / cancelled / payment_failed) — the
 * caller treats null as a no-op.
 *
 * Pickup leg: no route token, optional avoid-tolls (drivers can
 * deviate freely from the pre-computed pickup polyline).
 *
 * Dropoff leg: forwards `ride.routePreference.routeToken` if
 * present (rider-selected route from the Routes API) so the SDK
 * uses the rider's preferred path, plus `avoidTolls` for fallback
 * routing when no token is available.
 */
function buildLegParam(ride: Ride): {
  readonly leg: 'pickup' | 'dropoff';
  readonly title: string;
  readonly destination: { readonly lat: number; readonly lng: number };
  readonly routeToken?: string;
  readonly avoidTolls?: boolean;
} | null {
  switch (ride.status) {
    case 'dispatched':
    case 'scheduled_driver_accepted': {
      const avoidTolls = ride.routePreference?.avoidTolls;
      return {
        leg: 'pickup',
        title: 'Pickup Location',
        destination: {
          lat: ride.pickup.location.latitude,
          lng: ride.pickup.location.longitude,
        },
        ...(avoidTolls !== undefined ? { avoidTolls } : {}),
      };
    }
    case 'started': {
      const avoidTolls = ride.routePreference?.avoidTolls;
      const routeToken = ride.routePreference?.routeToken ?? null;
      return {
        leg: 'dropoff',
        title: 'Dropoff Location',
        destination: {
          lat: ride.dropoff.location.latitude,
          lng: ride.dropoff.location.longitude,
        },
        ...(routeToken !== null ? { routeToken } : {}),
        ...(avoidTolls !== undefined ? { avoidTolls } : {}),
      };
    }
    default:
      return null;
  }
}
