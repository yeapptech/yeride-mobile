import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { UserLocation } from '@domain/entities/UserLocation';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription, useOpenSettings } from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useCancelRideAsRiderMutation } from '@presentation/queries';
import {
  useChatUiStore,
  useGeofenceUiStore,
  useGpsLastGeofenceEvent,
  useGpsPermissionStatus,
} from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RideMonitorVM');

/**
 * View-model for `RideMonitorScreen`.
 *
 * Responsibilities:
 *
 *   1. Subscribe to the live ride doc via `ObserveRide` and to its
 *      audit-event log via `ObserveTripEvents`. Both use the generic
 *      `useFirestoreSubscription` adapter — synchronous unsubscribe, no
 *      async-cleanup footguns.
 *
 *   2. Surface the current ride status as a stable `RideStatus | null`
 *      so the screen's status-router renders the right view. `null`
 *      means "not loaded yet" — the screen renders a skeleton.
 *
 *   3. Wire the cancel mutation (`CancelRideByRider`). Surfaces
 *      `isCancelling` + `cancelError` for the screen's UI states.
 *
 *   4. Auto-redirect on terminal statuses:
 *        - `cancelled` → reset to RiderTabs.
 *        - `completed` → replace with RideReceipt (turn 3.4b).
 *        - `payment_failed` stays on RideMonitor (the rider sees the
 *          retry surface — actual retry mutation is Phase 6).
 *
 *   5. Geofence banner (Phase 7 turn 3): during `'dispatched'`, the
 *      pickup-area exit warning is **event-driven** off
 *      `useGpsLastGeofenceEvent()` — `useGpsLifecycle` (mounted at
 *      AppContent) is the producer; this VM is one of many consumers.
 *      An EXIT event flips `useGeofenceUiStore.pickupExitWarningVisible`
 *      to `true`; an ENTER event dismisses it. A `useRef` keyed on the
 *      event's `timestampMs` guards against re-handling the same event
 *      across re-renders. When `status` leaves `'dispatched'` the
 *      banner is dismissed unconditionally — defensive against stale
 *      visibility surviving a status flip. (Replaces the legacy
 *      foreground-poll path that ran `EvaluateExitWarning` against a
 *      `useCurrentLocation` tick.)
 *
 *   6. Chat stub (turn 3.4b): subscribes to `ObserveLatestMessage`
 *      (Phase-3-stub returns null) and exposes `unreadCount: 0` for
 *      the dot. `onPressChat` shows a "Phase 3.5" toast.
 *
 * The view-model does NOT mount the bottom-sheet. That's the screen's
 * job — keeping animation state out of the view-model means tests don't
 * need a bottom-sheet host to exercise status transitions.
 */

export interface UseRideMonitorViewModel {
  readonly ride: Ride | null;
  readonly status: RideStatus | null;
  readonly events: readonly TripEvent[];
  readonly latestMessage: ChatMessage | null;
  readonly hasUnreadMessages: boolean;
  readonly isCancelling: boolean;
  readonly cancelError: string | null;
  /**
   * Phase 9 turn 10. True when the BACKGROUND-geolocation SDK
   * permission has been explicitly denied AND the trip is in a
   * status window where GPS actively matters (`'dispatched'` or
   * `'started'` — geofence-exit warning + ETA both depend on it).
   * The screen renders a `<PermissionDeniedBanner/>` as a sibling
   * above the bottom-sheet when this is true. The `'undetermined'`
   * state is intentionally NOT covered — `useGpsLifecycle` will
   * fire the OS dialog soon, and `Linking.openSettings()` is the
   * wrong CTA before the user has been asked. Pre-trip /
   * post-trip statuses don't surface the banner: degraded ETA on
   * an awaiting/cancelled/completed trip is not actionable.
   */
  readonly bgPermissionDenied: boolean;
  /** Cancel the current ride with the given reason. */
  cancel: (args: {
    reason: CancellationReason;
    odometerMeters?: number;
  }) => Promise<boolean>;
  /** Open chat — Phase 3.5 stub: shows a toast for now. */
  onPressChat: () => void;
  /**
   * Phase 9 turn 10. Open the OS app-settings page. Wraps
   * `Linking.openSettings()`.
   */
  onOpenSettings: () => void;
  /**
   * Phase 10 turn 5 — live ETA from the driver's `users/{uid}.location`
   * doc. Subscribes via `SubscribeToUserLocation` keyed on
   * `ride.driver?.id` and reads `tripTracking.durationSeconds`.
   * Null when no driver assigned yet OR no live telemetry has
   * arrived. The rider's `DispatchedView` / `StartedView` prefer
   * this over `ride.pickup.directions.durationSeconds` /
   * `ride.dropoff.directions.durationSeconds`, falling back when
   * null — mirrors legacy `TripETAInfo`'s "Calculating…" surface.
   */
  readonly liveDurationSeconds: number | null;
  /** Live distance in metres, paired with `liveDurationSeconds`. */
  readonly liveDistanceMeters: number | null;
}

export function useRideMonitorViewModel(args: {
  rideId: RideId;
}): UseRideMonitorViewModel {
  const { rideId } = args;
  const useCases = useUseCases();
  const navigation = useNavigation<RiderStackNavigation>();

  // ── Live ride doc ──────────────────────────────────────────────
  const subscribeRide = useCallback(
    (cb: (ride: Ride | null) => void) =>
      useCases.observeRide.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const ride = useFirestoreSubscription<Ride | null>(subscribeRide, null);

  // ── Audit-event log ────────────────────────────────────────────
  const subscribeEvents = useCallback(
    (cb: (events: readonly TripEvent[]) => void) =>
      useCases.observeTripEvents.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const events = useFirestoreSubscription<readonly TripEvent[]>(
    subscribeEvents,
    [],
  );

  // ── Latest chat message (Phase 3 stub: always null) ────────────
  const subscribeLatestMessage = useCallback(
    (cb: (message: ChatMessage | null) => void) =>
      useCases.observeLatestMessage.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const latestMessage = useFirestoreSubscription<ChatMessage | null>(
    subscribeLatestMessage,
    null,
  );

  const lastReadAt = useChatUiStore((s) => s.lastReadAt);
  const hasUnreadMessages = useMemo(() => {
    if (!latestMessage) return false;
    if (!lastReadAt) return true;
    return latestMessage.createdAt.getTime() > lastReadAt.getTime();
  }, [latestMessage, lastReadAt]);

  const status = ride?.status ?? null;

  // ── Geofence banner (Phase 7 turn 3) ───────────────────────────
  // Event-driven off `useGpsLifecycle`'s pickup-geofence subscription.
  // `useGpsLifecycle` (mounted at AppContent) registers / deregisters
  // the geofence based on the active ride's status; this VM only reads
  // the resulting events. The legacy foreground-poll path
  // (`EvaluateExitWarning` against `useCurrentLocation`) is retired.
  //
  // Guards:
  //   - Status gate: only react while `status === 'dispatched'`. Other
  //     statuses dismiss the banner (defensive — covers a stale `true`
  //     surviving a server-side flip out of dispatched).
  //   - Identifier gate: only `'pickup'` events drive the banner.
  //   - Action gate: ENTER → dismiss; EXIT → show.
  //   - Replay guard: a `useRef` keyed on `timestampMs` prevents
  //     re-handling the same event across re-renders. Cleared when the
  //     status leaves dispatched so a re-entry into dispatched on a
  //     subsequent ride starts fresh.
  const lastGeofenceEvent = useGpsLastGeofenceEvent();
  const showPickupExitWarning = useGeofenceUiStore(
    (s) => s.showPickupExitWarning,
  );
  const dismissPickupExitWarning = useGeofenceUiStore(
    (s) => s.dismissPickupExitWarning,
  );
  const lastHandledGeofenceTsRef = useRef<number | null>(null);
  useEffect(() => {
    if (status !== 'dispatched') {
      dismissPickupExitWarning();
      lastHandledGeofenceTsRef.current = null;
      return;
    }
    if (!lastGeofenceEvent) return;
    if (lastGeofenceEvent.identifier !== 'pickup') return;
    if (lastHandledGeofenceTsRef.current === lastGeofenceEvent.timestampMs) {
      return;
    }
    lastHandledGeofenceTsRef.current = lastGeofenceEvent.timestampMs;
    if (lastGeofenceEvent.action === 'EXIT') {
      showPickupExitWarning();
    } else {
      dismissPickupExitWarning();
    }
  }, [
    status,
    lastGeofenceEvent,
    showPickupExitWarning,
    dismissPickupExitWarning,
  ]);

  // ── Cancel ─────────────────────────────────────────────────────
  const cancelMutation = useCancelRideAsRiderMutation();
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

  // ── Chat stub ──────────────────────────────────────────────────
  const onPressChat = useCallback(() => {
    Toast.show({
      type: 'info',
      text1: 'Messaging coming soon',
      text2: 'Chat threads land in Phase 3.5.',
      visibilityTime: 2500,
    });
  }, []);

  // ── Terminal redirects ─────────────────────────────────────────
  // Use a ref to remember whether we already dispatched a redirect so a
  // re-render with the same terminal status doesn't fire navigation
  // twice (which can pop-and-push and cause a flash).
  //
  // CRITICAL: this MUST be a `useEffect`, not a `useMemo`. Calling
  // `navigation.reset` / `navigation.replace` mid-render (which is what
  // a `useMemo` body does) updates the navigation container's state
  // synchronously, producing the React 19 warning "Cannot update a
  // component (`BaseNavigationContainer`) while rendering a different
  // component (`RideMonitorContent`)". Side effects belong in effects.
  // Mirrors the pattern in `useDriverMonitorViewModel`.
  const redirectedRef = useRef<RideStatus | null>(null);
  useEffect(() => {
    if (!status) return;
    if (redirectedRef.current === status) return;
    if (status === 'cancelled') {
      redirectedRef.current = status;
      logger.info('terminal: cancelled — resetting to home');
      navigation.reset({
        index: 0,
        routes: [{ name: 'RiderTabs' }],
      });
      return;
    }
    if (status === 'completed') {
      redirectedRef.current = status;
      logger.info('terminal: completed — replacing with RideReceipt');
      navigation.replace('RideReceipt', { rideId: String(rideId) });
      return;
    }
    // `payment_failed` is intentionally NOT a redirect: the rider stays
    // on RideMonitor and sees the retry surface (PaymentFailedView).
    // The retry mutation itself is Phase 6.
  }, [status, navigation, rideId]);

  // Phase 9 turn 10. Surface BG-geolocation permission denial only
  // during the trip statuses where GPS actively matters. The screen
  // mounts a `<PermissionDeniedBanner/>` keyed on this flag.
  const bgPermissionStatus = useGpsPermissionStatus();
  const bgPermissionDenied =
    bgPermissionStatus === 'denied' &&
    (status === 'dispatched' || status === 'started');
  const onOpenSettings = useOpenSettings();

  // ── Live driver ETA (Phase 10 turn 5) ──────────────────────────
  // Subscribe to the driver's `users/{uid}.location` doc via
  // `SubscribeToUserLocation`, keyed on `ride.driver?.id`. The
  // returned `UserLocation.tripTracking` carries the driver-side
  // populated `distanceMeters / durationSeconds / updatedAt` written
  // by `useDriverMonitorViewModel`. We surface the two values as
  // `liveDistanceMeters` / `liveDurationSeconds` so the rider's
  // status views can prefer them over the static
  // `ride.pickup.directions` / `ride.dropoff.directions` (set at
  // dispatch / trip-create time and never updated).
  //
  // Null on:
  //   - no driver assigned yet (awaiting_driver)
  //   - driver assigned but `users/{uid}.location` doc hasn't been
  //     written yet (first GPS event still en-route)
  //   - written, but `tripTracking.distanceMeters / durationSeconds`
  //     are null (route-metadata-only doc; NavSdk telemetry hasn't
  //     fired yet, or has gone stale)
  //
  // Replaces the legacy `LocationContext.subscribeToUserLocation`
  // path (`DispatchedView.useEffect` in legacy yeride). Decision 3
  // chose (a): reuse the generic use case keyed by driver id rather
  // than introducing an `ObserveDriverLocation` wrapper — VM effect
  // cleanup already handles the ride-switch race.
  //
  // Cross-trip staleness gate: nothing in the write path clears
  // `users/{driverId}.location.tripTracking` at trip end —
  // `useGpsLifecycle` emits `tripTracking: null` on the entity but
  // `userLocationMapper.toDoc` OMITS the field entirely when null
  // (intentional, so GPS writes don't clobber the VM's throttled
  // writes via `merge:true`). That means a driver's location doc
  // can carry the previous trip's `tripTracking` until the new
  // ride's `useDriverMonitorViewModel` lands its first write. The
  // rider would otherwise see the previous trip's ETA on the new
  // trip's `DispatchedView` for that brief window. Gate the live
  // fields on `tripTracking.tripId === ride.id` so a stale doc
  // surfaces as `null` (→ static `ride.pickup.directions` fallback).
  const driverId = ride?.driver?.id ?? null;
  const [driverLocation, setDriverLocation] = useState<UserLocation | null>(
    null,
  );
  useEffect(() => {
    if (!driverId) {
      setDriverLocation(null);
      return;
    }
    // SubscribeToUserLocation emits null when the doc is missing OR
    // on stream error — the effect treats both the same: clear local
    // state and wait for the next emission.
    const unsubscribe = useCases.subscribeToUserLocation.execute({
      userId: driverId,
      callback: (loc) => setDriverLocation(loc),
    });
    return unsubscribe;
  }, [useCases, driverId]);

  // Compare-by-value: `tripTracking.tripId` is a branded RideId
  // (string under the hood); `ride.id` is the same brand. `String(…)`
  // coerce on both sides avoids the brand-equality footgun if a
  // future change drifts the brand.
  const driverTripTracking = driverLocation?.tripTracking ?? null;
  const driverTripIdMatchesRide =
    driverTripTracking !== null &&
    ride !== null &&
    String(driverTripTracking.tripId) === String(ride.id);
  const liveDurationSeconds =
    driverTripIdMatchesRide && driverTripTracking !== null
      ? (driverTripTracking.durationSeconds ?? null)
      : null;
  const liveDistanceMeters =
    driverTripIdMatchesRide && driverTripTracking !== null
      ? (driverTripTracking.distanceMeters ?? null)
      : null;

  return {
    ride,
    status,
    events,
    latestMessage,
    hasUnreadMessages,
    isCancelling: cancelMutation.isPending,
    cancelError,
    bgPermissionDenied,
    cancel,
    onPressChat,
    onOpenSettings,
    liveDurationSeconds,
    liveDistanceMeters,
  };
}
