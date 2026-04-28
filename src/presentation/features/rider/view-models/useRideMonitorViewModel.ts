import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { TripEvent } from '@domain/entities/TripEvent';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useCancelRideAsRiderMutation } from '@presentation/queries';
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
 *   3. Wire the cancel mutation. Phase 3 turn 3.4a only needs the
 *      rider-side path (CancelRideByRider). The mutation's `onSuccess`
 *      seed flow is owned by `useCancelRideAsRiderMutation` itself.
 *
 *   4. Auto-redirect on terminal status. Phase 3 turn 3.4a routes
 *      `cancelled` → back to home. `completed` and `payment_requested →
 *      payment_failed` land in turn 3.4b along with their views.
 *
 * The view-model does NOT mount the bottom-sheet. That's the screen's
 * job — keeping animation state out of the view-model means tests don't
 * need a bottom-sheet host to exercise status transitions.
 */

export interface UseRideMonitorViewModel {
  readonly ride: Ride | null;
  readonly status: RideStatus | null;
  readonly events: readonly TripEvent[];
  readonly isCancelling: boolean;
  readonly cancelError: string | null;
  /** Cancel the current ride with the given reason. */
  cancel: (args: {
    reason: CancellationReason;
    odometerMeters?: number;
  }) => Promise<boolean>;
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

  const status = ride?.status ?? null;

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

  // ── Terminal redirects ─────────────────────────────────────────
  // Use a ref to remember whether we already dispatched a redirect so a
  // re-render with the same terminal status doesn't fire navigation
  // twice (which can pop-and-push and cause a flash).
  const redirectedRef = useRef<RideStatus | null>(null);
  const _redirectIfTerminal = useMemo(() => {
    if (!status) return;
    if (redirectedRef.current === status) return;
    if (status === 'cancelled') {
      redirectedRef.current = status;
      logger.info('terminal: cancelled — popping to home');
      // Reset to the rider tabs so back nav doesn't return to a dead ride.
      navigation.reset({
        index: 0,
        routes: [{ name: 'RiderTabs' }],
      });
    }
    // 'completed' and 'payment_failed' redirects land in turn 3.4b alongside
    // CompletedView / PaymentFailedView. Until then RideMonitor displays
    // those statuses as-is.
  }, [status, navigation]);
  void _redirectIfTerminal;

  return {
    ride,
    status,
    events,
    isCancelling: cancelMutation.isPending,
    cancelError,
    cancel,
  };
}
