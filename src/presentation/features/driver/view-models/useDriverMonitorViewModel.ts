import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';
import type { NavTimeAndDistance } from '@domain/services';
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
  useChatLastReadAtForRide,
  useChatUiStore,
  useDriverStatusStore,
  useGpsCurrentLocation,
  useGpsCurrentOdometer,
  useGpsCurrentSpeed,
  useGpsIsInsidePickupGeofence,
  useSessionStore,
} from '@presentation/stores';
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
 *   3. Mode mirror into `useDriverStatusStore`. The store flag is what
 *      DriverHome / the tabs / a future Earnings surface read; we keep
 *      it in lock-step with the live ride.
 *        - `dispatched`             → 'dispatched'
 *        - `started` / `payment_requested` / `payment_failed` /
 *          `completed`               → 'on_trip'
 *        - `cancelled`              → 'online_idle' (driver re-joins
 *                                     the queue)
 *
 *   4. `arrivedAtPickup` UI flag, derived (Phase 7 turn 3) from
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
 *   5. Three Cloud-Function-or-direct-write mutations:
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
 *   6. Terminal redirects on `cancelled` AND `completed`: both fire
 *      `navigation.reset({ index: 0, routes: [{ name: 'DriverTabs' }] })`.
 *      `payment_failed` is intentionally NOT a terminal redirect — the
 *      driver stays on the screen and sees the failure card with the
 *      "Close trip" CTA. `redirectedRef` guards against re-firing
 *      across re-renders.
 *
 * Phase 9 turn 4 removed the VM-owned foreground location push
 * (`lastWrittenCoordsRef` + `useUpdateLocationMutation`). The
 * Phase 7 turn 2 `useGpsLifecycle` hook (mounted exactly once at
 * AppContent) now owns location writes — its location subscription
 * fires `useUpdateLocationMutation.mutate(...)` per SDK delivery,
 * gated by AppContent's `enabled` predicate which already covers
 * the driver-on-trip state. The VM no longer takes a
 * `driverLocation` arg.
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
  /* ── Chat (Phase 10 turn 8) ──────────────────────────────────── */
  /** Most-recent chat message for the unread-dot derivation. */
  readonly latestMessage: ChatMessage | null;
  /** Derived from latest message createdAt vs `useChatUiStore.lastReadAt`. */
  readonly hasUnreadMessages: boolean;
  /** Open the in-trip chat modal. Sets `useChatUiStore.openRideId`,
   *  fires `markMessagesRead({role: 'driver'})`, and flips `chatOpen`. */
  onPressChat: () => void;
  /** Whether the driver-side chat modal is currently mounted. */
  readonly chatOpen: boolean;
  /** Tear down the chat modal — clears local + store-side open state. */
  closeChat: () => void;
}

export interface DriverMonitorViewModelArgs {
  readonly rideId: RideId;
}

export function useDriverMonitorViewModel(
  args: DriverMonitorViewModelArgs,
): UseDriverMonitorViewModel {
  const { rideId } = args;
  const useCases = useUseCases();
  const navigation = useNavigation<DriverStackNavigation>();
  const navigationSdk = useNavigationSdk();
  const setMode = useDriverStatusStore((s) => s.setMode);
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

  // ── Live ETA telemetry → tripTracking write (Phase 10 turn 5) ──
  // The legacy `DriverHome.handleLocationChange` pipeline pushed
  // `users/{driverId}.location.tripTracking` with `{distance, duration,
  // calculatedAt}` per GPS event so the rider's `TripETAInfo`
  // surfaces a live "driver arriving in X" / "arriving in X" string.
  // The rewrite owns this in the driver VM (decision 2 — Path α): the
  // active-trip lifecycle lives where the ride state lives, and
  // Firestore `set({merge: true})` makes the race against
  // `useGpsLifecycle`'s plain location writes harmless.
  //
  // Sources:
  //   - NavSdk telemetry via `navigationSdk.subscribeToTimeAndDistance`.
  //     The SDK fires on geo / traffic deltas (and standstill — the
  //     adapter dedupes those out).
  //   - Driver GPS via `useGpsCurrentLocation()` + `useGpsCurrentSpeed()`
  //     from the Zustand store (`useGpsLifecycle` is the only writer).
  //   - Session user id via `useSessionStore` for the location's owner.
  //
  // Throttle (copied verbatim from legacy
  // `yeride/src/api/services/distanceTrackingService.js`):
  //   - min 30s between Firestore writes
  //   - skip if last write was within 50m of current GPS
  //   - skip if NavSdk reading is older than 60s (data staleness gate
  //     mirrors legacy `THROTTLE_CONFIG.maxAge`)
  //
  // The 15s NavSdk-fresh window from legacy is implicit here — we
  // only have NavSdk data because the SDK fired into our subscriber,
  // so by construction it's at most a few ms stale. If the SDK
  // stops firing (e.g. driver enters a tunnel), the existing
  // `useGpsLifecycle` GPS writes continue with `tripTracking: null`
  // and the rider falls back to the static `ride.pickup.directions`
  // ETA. Distance Matrix fallback is deliberately out of scope per
  // kickoff §"Out of scope".
  const updateLocationMutation = useUpdateLocationMutation();
  const driverUserId = useSessionStore((s) => s.userId);
  const gpsLocation = useGpsCurrentLocation();
  const gpsSpeed = useGpsCurrentSpeed();
  const isActiveTripStatus =
    ride?.status === 'dispatched' || ride?.status === 'started';

  // Refs for throttle bookkeeping. Keeping latest values in refs lets
  // the long-lived subscription effect read them without re-mounting
  // the SDK listener every render.
  const lastWriteAtMsRef = useRef<number>(0);
  const lastWriteCoordsRef = useRef<Coordinates | null>(null);
  /**
   * Whether the LAST tripTracking write carried live NavSdk telemetry.
   * Drives the bypass-the-30s-gate-when-first-live-data-arrives rule:
   * if the last write was nav-less and a fresh NavSdk fire shows up,
   * we land it immediately rather than waiting out the throttle. After
   * that first live write, subsequent NavSdk fires respect the gate
   * normally (legacy throttle stays in effect).
   */
  const lastWriteHadTelemetryRef = useRef<boolean>(false);
  const latestNavSdkRef = useRef<NavTimeAndDistance | null>(null);
  const latestGpsRef = useRef<{
    location: Coordinates | null;
    speed: number | null;
  }>({ location: gpsLocation, speed: gpsSpeed });
  latestGpsRef.current = { location: gpsLocation, speed: gpsSpeed };
  const updateLocationMutationRef = useRef(updateLocationMutation);
  updateLocationMutationRef.current = updateLocationMutation;
  const driverUserIdRef = useRef(driverUserId);
  driverUserIdRef.current = driverUserId;
  const rideRef = useRef(ride);
  rideRef.current = ride;

  useEffect(() => {
    if (!isActiveTripStatus) {
      // Reset throttle state when the trip leaves the active window so
      // the next dispatched trip starts with a clean slate.
      lastWriteAtMsRef.current = 0;
      lastWriteCoordsRef.current = null;
      lastWriteHadTelemetryRef.current = false;
      latestNavSdkRef.current = null;
      return;
    }

    // Subscribe to NavSdk telemetry. The adapter dedupes consecutive
    // identical fires; we just cache the latest and try a write.
    const unsubscribe = navigationSdk.subscribeToTimeAndDistance(
      (event: NavTimeAndDistance) => {
        latestNavSdkRef.current = event;
        tryWriteTripTracking({
          source: 'navsdk',
          navSdk: event,
          gps: latestGpsRef.current,
          userId: driverUserIdRef.current,
          ride: rideRef.current,
          lastWriteAtMsRef,
          lastWriteCoordsRef,
          lastWriteHadTelemetryRef,
          mutation: updateLocationMutationRef.current,
        });
      },
    );
    return unsubscribe;
  }, [isActiveTripStatus, navigationSdk]);

  // Phase 10 turn 5 (review fix) — reset bypass-eligibility on a
  // destination switch WITHIN the active window. Legacy parity has
  // dispatched→started keep the same tripId so the throttle would
  // otherwise hold for up to 30s after the swap, showing the stale
  // pickup-leg ETA on the rider's `StartedView`. Resetting both the
  // time gate AND the telemetry flag lets the next NavSdk fire land
  // the dropoff-leg ETA via the existing bypass path.
  const activeRideStatus = isActiveTripStatus ? (ride?.status ?? null) : null;
  useEffect(() => {
    if (activeRideStatus === null) return;
    lastWriteAtMsRef.current = 0;
    lastWriteHadTelemetryRef.current = false;
    // Intentionally leave `lastWriteCoordsRef` so the 50m distance
    // gate still rejects writes if the driver hasn't physically
    // moved. The time-gate reset alone is what unblocks the bypass.
  }, [activeRideStatus]);

  // Second effect: on every GPS update, also try a write. This handles
  // the case where NavSdk telemetry hasn't arrived yet but the driver
  // is moving — we still want the throttle to advance against
  // distance/time, and we still want `tripTracking.destination` on
  // the doc so the rider's UI can map it.
  //
  // Deps are intentionally minimal: `gpsLocation` and `gpsSpeed` are
  // the only stimuli we want to react to. `driverUserId` /
  // `updateLocationMutation` / `ride` are read from refs so this
  // effect doesn't churn on every render (TanStack's `useMutation`
  // returns a fresh wrapper on each state transition, which would
  // otherwise re-fire this effect dozens of times per active GPS
  // second).
  useEffect(() => {
    if (!isActiveTripStatus) return;
    tryWriteTripTracking({
      source: 'gps',
      navSdk: latestNavSdkRef.current,
      gps: { location: gpsLocation, speed: gpsSpeed },
      userId: driverUserIdRef.current,
      ride: rideRef.current,
      lastWriteAtMsRef,
      lastWriteCoordsRef,
      lastWriteHadTelemetryRef,
      mutation: updateLocationMutationRef.current,
    });
  }, [isActiveTripStatus, gpsLocation, gpsSpeed]);

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
          // Phase 9 turn 4 — chain-fatal: the user can't proceed
          // without accepting terms, and the dialog itself errored
          // (not a deliberate decline). Flip warn→error so the
          // rawMeta channel fans out to `recordError`. `termsR.error`
          // is a `DomainError`.
          logger.error('terms dialog failed', termsR.error);
          Toast.show({
            type: 'error',
            text1: 'Could not show terms dialog. Please try again.',
          });
          return;
        }
        if (!termsR.value.accepted) {
          // User declined. Don't badger them with a Toast — declining
          // is a deliberate choice. Stays at info level (no
          // recordError fan-out — declining is not an error).
          logger.info('terms declined by user');
          return;
        }
        initR = await navigationSdk.init();
      }
      if (!initR.ok) {
        // Phase 9 turn 4 — chain-fatal: navigation init failed for a
        // reason other than terms-not-accepted (network, auth, etc.).
        // Flip warn→error so the rawMeta channel fans out to
        // `recordError`. `initR.error` is a `DomainError`.
        logger.error('navigation init failed', initR.error);
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

  // ── Chat (Phase 10 turn 8) ─────────────────────────────────────
  // Driver-side mirror of the rider chat wiring. Subscribe to the
  // latest message for the unread dot — GATED on an active trip
  // status (Suggestion #7): post-cutover the screen redirects on
  // terminal status, but the brief window before the redirect lands
  // would otherwise drive `markMessagesRead` writes against a
  // closed trip. Same review pulled `chatLastReadAt` onto a per-ride
  // selector to avoid cross-ride bleed (Critical #2). `hasUnread` is
  // gated by `currentUserId` so own outbound messages don't light
  // the dot (Critical #1).
  const subscribeLatestMessage = useCallback(
    (cb: (message: ChatMessage | null) => void) => {
      if (!isActiveTripStatus) {
        // Emit null synchronously so the consumer state is correct;
        // the noop unsubscribe satisfies the cleanup contract.
        cb(null);
        return () => undefined;
      }
      return useCases.observeLatestMessage.execute({ rideId, callback: cb });
    },
    [useCases, rideId, isActiveTripStatus],
  );
  const latestMessage = useFirestoreSubscription<ChatMessage | null>(
    subscribeLatestMessage,
    null,
  );
  const chatLastReadAt = useChatLastReadAtForRide(rideId);
  const currentDriverUserId = useSessionStore((s) => s.userId);
  const hasUnreadMessages = useMemo(() => {
    if (!latestMessage) return false;
    if (
      currentDriverUserId !== null &&
      String(latestMessage.senderId) === String(currentDriverUserId)
    ) {
      return false;
    }
    if (!chatLastReadAt) return true;
    return latestMessage.createdAt.getTime() > chatLastReadAt.getTime();
  }, [latestMessage, chatLastReadAt, currentDriverUserId]);

  const [chatOpen, setChatOpen] = useState(false);
  const openChatInStore = useChatUiStore((s) => s.open);
  const closeChatInStore = useChatUiStore((s) => s.close);
  const markRead = useChatUiStore((s) => s.markRead);
  const onPressChat = useCallback(() => {
    setChatOpen(true);
    openChatInStore(rideId);
    markRead(rideId, new Date());
    void useCases.markMessagesRead
      .execute({ rideId, role: 'driver' })
      .then((r) => {
        if (!r.ok) {
          // Cleanup-best-effort path — stays warn.
          logger.warn('markMessagesRead (driver) failed', {
            code: r.error.code,
          });
        }
      });
  }, [openChatInStore, markRead, useCases, rideId]);
  const closeChat = useCallback(() => {
    setChatOpen(false);
    closeChatInStore();
  }, [closeChatInStore]);

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
    latestMessage,
    hasUnreadMessages,
    onPressChat,
    chatOpen,
    closeChat,
  };
}

/* ───── Helpers ───── */

/**
 * Phase 10 turn 5 — throttle constants ported verbatim from legacy
 * `yeride/src/api/services/distanceTrackingService.js`. Tuning lives
 * in a post-cutover turn; parity-first is the Phase 10 stance.
 */
const TRIP_TRACKING_MIN_INTERVAL_MS = 30_000;
const TRIP_TRACKING_MIN_DISTANCE_M = 50;
const TRIP_TRACKING_NAVSDK_MAX_AGE_MS = 60_000;

const tripTrackingLogger = LOG.extend('DriverTripTracking');

interface TryWriteArgs {
  /** Just for telemetry — which subscription triggered this attempt. */
  readonly source: 'navsdk' | 'gps';
  readonly navSdk: NavTimeAndDistance | null;
  readonly gps: {
    readonly location: Coordinates | null;
    readonly speed: number | null;
  };
  readonly userId: UserId | null;
  readonly ride: Ride | null;
  readonly lastWriteAtMsRef: { current: number };
  readonly lastWriteCoordsRef: { current: Coordinates | null };
  readonly lastWriteHadTelemetryRef: { current: boolean };
  readonly mutation: ReturnType<typeof useUpdateLocationMutation>;
}

/**
 * Build a populated `UserLocation` (with `tripTracking.distanceMeters
 * / durationSeconds / updatedAt` if NavSdk has fired) and fire the
 * update mutation, gated by the legacy throttle constants.
 *
 * Throttle conditions (any one trips a skip):
 *   - within 30s of the last successful write
 *   - within 50m of the last-written coords
 *   - NavSdk data older than 60s (staleness gate — let useGpsLifecycle's
 *     plain GPS write take over with tripTracking: null)
 *
 * On no-NavSdk yet (pre-first-callback), the write still goes through
 * with `distance/duration/updatedAt: null` — the destination + status
 * carry the route-metadata-only shape so the rider can fall back to
 * `ride.pickup.directions` without missing UI state.
 */
function tryWriteTripTracking(args: TryWriteArgs): void {
  const {
    source,
    navSdk,
    gps,
    userId,
    ride,
    lastWriteAtMsRef,
    lastWriteCoordsRef,
    lastWriteHadTelemetryRef,
    mutation,
  } = args;

  if (!userId || !ride || !gps.location) return;
  if (ride.status !== 'dispatched' && ride.status !== 'started') return;

  const now = Date.now();

  // NavSdk staleness gate — if telemetry is older than 60s, treat
  // this write as nav-less.
  const navSdkFresh =
    navSdk !== null &&
    now - navSdk.timestampMs < TRIP_TRACKING_NAVSDK_MAX_AGE_MS;

  // Time-gate bypass: when a fresh NavSdk fire arrives AND the last
  // write didn't carry telemetry, land it immediately so the rider
  // sees live ETA without waiting out the 30s window. After that
  // first live write, subsequent NavSdk fires respect the gate
  // (legacy parity preserved).
  const bypassThrottle =
    source === 'navsdk' && navSdkFresh && !lastWriteHadTelemetryRef.current;

  if (
    !bypassThrottle &&
    now - lastWriteAtMsRef.current < TRIP_TRACKING_MIN_INTERVAL_MS
  ) {
    return;
  }

  if (!bypassThrottle) {
    const lastCoords = lastWriteCoordsRef.current;
    if (
      lastCoords !== null &&
      haversineMetres(lastCoords, gps.location) < TRIP_TRACKING_MIN_DISTANCE_M
    ) {
      return;
    }
  }

  // Destination from current ride status — legacy parity.
  const destLocation: Coordinates =
    ride.status === 'dispatched' ? ride.pickup.location : ride.dropoff.location;
  const destType: 'pickup' | 'dropoff' =
    ride.status === 'dispatched' ? 'pickup' : 'dropoff';

  const distanceMeters = navSdkFresh ? navSdk.remainingMeters : null;
  const durationSeconds = navSdkFresh ? navSdk.remainingSeconds : null;
  const trackingUpdatedAt = navSdkFresh ? new Date(navSdk.timestampMs) : null;

  const locR = UserLocation.create({
    userId,
    location: gps.location,
    speed: gps.speed,
    updatedAt: new Date(now),
    tripTracking: {
      tripId: ride.id,
      tripStatus: ride.status,
      destination: { type: destType, location: destLocation },
      distanceMeters,
      durationSeconds,
      updatedAt: trackingUpdatedAt,
    },
  });
  if (!locR.ok) {
    // Construct error for rawMeta channel — matches the
    // useGpsLifecycle handler at L253. ValidationError here means a
    // contract bug.
    tripTrackingLogger.error(
      'UserLocation.create failed',
      new Error(locR.error.code),
    );
    return;
  }

  lastWriteAtMsRef.current = now;
  lastWriteCoordsRef.current = gps.location;
  lastWriteHadTelemetryRef.current = navSdkFresh;
  mutation.mutate(locR.value, {
    onError: (e) => {
      tripTrackingLogger.error('updateLocation mutation failed', e);
    },
  });
}

/**
 * Phase 10 turn 5 — haversine distance in metres between two
 * `Coordinates`. Same formula legacy
 * `yeride/src/api/maps/GoogleMapsAPI.js` uses for its
 * `calculateDistance` helper (mi conversion folded in at the call
 * site; here we stay in metres).
 */
function haversineMetres(a: Coordinates, b: Coordinates): number {
  const earthRadiusM = 6_371_000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

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
