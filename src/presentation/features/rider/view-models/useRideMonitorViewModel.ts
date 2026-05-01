import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { ChatMessage } from '@domain/entities/ChatMessage';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { TripEvent } from '@domain/entities/TripEvent';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useCancelRideAsRiderMutation } from '@presentation/queries';
import {
  useChatUiStore,
  useGeofenceUiStore,
  useGpsLastGeofenceEvent,
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
  /** Cancel the current ride with the given reason. */
  cancel: (args: {
    reason: CancellationReason;
    odometerMeters?: number;
  }) => Promise<boolean>;
  /** Open chat — Phase 3.5 stub: shows a toast for now. */
  onPressChat: () => void;
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

  return {
    ride,
    status,
    events,
    latestMessage,
    hasUnreadMessages,
    isCancelling: cancelMutation.isPending,
    cancelError,
    cancel,
    onPressChat,
  };
}
