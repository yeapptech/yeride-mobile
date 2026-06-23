import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { User } from '@domain/entities/User';
import { ConflictError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useAcceptScheduledRideMutation,
  useBeginScheduledRideMutation,
  useCurrentUserQuery,
  useDispatchRideMutation,
} from '@presentation/queries';
import { useDriverStatusStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('DriverDispatchVM');

/**
 * View-model for `DriverDispatchScreen`.
 *
 * Composes:
 *   - Live `ObserveRide` subscription on the rideId. Drives the screen's
 *     initial paint AND lets us flip to `'gone'` when another driver wins
 *     the race (status flips off `awaiting_driver` server-side).
 *   - `useCurrentUserQuery` — driver profile, used to build a
 *     `DriverSnapshot` for the dispatch call. The factory rejects empty
 *     `stripeAccountId`, which is exactly the gate we want — drivers
 *     without Connect onboarding can't accept and the view-model
 *     surfaces `'cannot_accept' (no_stripe_connect)` before any mutation
 *     attempts to run.
 *   - Driver location is passed in (the screen reads `useCurrentLocation`
 *     and feeds it down). Keeps this VM testable without an
 *     `expo-location` mock — the parent screen already owns location for
 *     the map. Used only for the Haversine "X mi to pickup" label.
 *   - `useDispatchRideMutation` — the accept handler. NO Google Routes
 *     call here: the screen must paint accept/decline instantly. The
 *     winning driver computes + attaches the driver→pickup directions
 *     AFTER the claim, in the monitor (`useAttachPickupDirections`). On
 *     success: writes `useDriverStatusStore.setMode('dispatched')` and
 *     replaces the navigation stack with `DriverMonitor` so back-nav
 *     doesn't bounce the driver back into the dispatch screen mid-trip.
 *
 * No dispatch model with offer-timeouts; YeRide is driver-pull (drivers
 * pick from the available list; whichever accepts first wins the atomic
 * `transitionWithClaim`). A driver who loses the race gets a
 * `ConflictError('ride_already_taken')` from the mutation → we flip to
 * `'gone'` (the "Already taken" panel). The live `ObserveRide` is a second
 * line of defence that also flips us to `'gone'` when the status drifts.
 */

export type DriverDispatchStatus =
  | 'loading'
  | 'cannot_accept'
  | 'ready'
  | 'accepting'
  | 'gone';

export type CannotAcceptReason =
  | 'no_stripe_connect'
  | 'no_active_vehicle'
  | 'wrong_status';

/**
 * Which driver action this dispatch-screen visit performs, derived from the
 * ride's status when the screen first painted (pinned — see the VM body).
 */
export type DispatchAction = 'accept' | 'accept_schedule' | 'begin';

function actionForStatus(status: RideStatus): DispatchAction | null {
  switch (status) {
    case 'awaiting_driver':
      return 'accept';
    case 'scheduled':
      return 'accept_schedule';
    case 'scheduled_driver_accepted':
      return 'begin';
    default:
      return null;
  }
}

export interface UseDriverDispatchViewModel {
  readonly status: DriverDispatchStatus;
  readonly ride: Ride | null;
  readonly user: User | null;
  readonly driverLocation: Coordinates | null;
  readonly cannotAcceptReason: CannotAcceptReason | null;
  /** Which action the Accept button performs (null until the ride loads). */
  readonly action: DispatchAction | null;
  /** Accept the offer. Builds a DriverSnapshot, calls DispatchRide. */
  onAccept: () => void;
  /** Decline → pop back to DriverHome. No server-side trace in Turn 3. */
  onDecline: () => void;
}

export interface DriverDispatchViewModelArgs {
  readonly rideId: RideId;
  readonly driverLocation: Coordinates | null;
}

export function useDriverDispatchViewModel(
  args: DriverDispatchViewModelArgs,
): UseDriverDispatchViewModel {
  const { rideId, driverLocation } = args;
  const navigation = useNavigation<DriverStackNavigation>();
  const useCases = useUseCases();
  const userQuery = useCurrentUserQuery();
  const setMode = useDriverStatusStore((s) => s.setMode);
  const dispatchMutation = useDispatchRideMutation();
  const acceptScheduleMutation = useAcceptScheduledRideMutation();
  const beginMutation = useBeginScheduledRideMutation();

  // Live ride subscription — initial paint + race-condition detection.
  const subscribedRide = useFirestoreSubscription<Ride | null>(
    useCallback(
      (cb) => useCases.observeRide.execute({ rideId, callback: cb }),
      [useCases, rideId],
    ),
    null,
  );

  const user = userQuery.data ?? null;

  // Pin the action to the FIRST status the subscription emits. Anchoring to
  // the initial status (rather than the live one) is what makes 'gone'
  // correct: if a 'scheduled' ride we're looking at flips to
  // 'scheduled_driver_accepted' because another driver accepted it, the
  // live status no longer matches our pinned intent → 'gone' (we must NOT
  // re-derive the action to 'begin' and let this driver hijack it).
  const intentStatusRef = useRef<RideStatus | null>(null);
  if (intentStatusRef.current === null && subscribedRide !== null) {
    intentStatusRef.current = subscribedRide.status;
  }
  const intentStatus = intentStatusRef.current;
  const action = intentStatus !== null ? actionForStatus(intentStatus) : null;

  const anyPending =
    dispatchMutation.isPending ||
    acceptScheduleMutation.isPending ||
    beginMutation.isPending;
  const anySuccess =
    dispatchMutation.isSuccess ||
    acceptScheduleMutation.isSuccess ||
    beginMutation.isSuccess;

  // Set when a claim mutation fails with ConflictError — another driver
  // won the race. Forces `'gone'` (the "Already taken" panel) authoritatively
  // rather than waiting on the live ObserveRide subscription to notice the
  // status drift.
  const [claimFailed, setClaimFailed] = useState(false);

  // Status derivation. Order matters:
  //   1. `'gone'` — ride was taken by someone else (status flipped off
  //      `awaiting_driver`). Beats every other state.
  //   2. `'accepting'` — mutation in flight.
  //   3. `'cannot_accept'` — driver doesn't have what we need to accept.
  //   4. `'loading'` — we're still resolving user / route.
  //   5. `'ready'` — everything in place.
  const cannotAcceptReason = useMemo<CannotAcceptReason | null>(() => {
    if (!user || user.role !== 'driver') return null;
    if (!user.stripeAccountId) return 'no_stripe_connect';
    if (!user.activeVehicleId) return 'no_active_vehicle';
    return null;
  }, [user]);

  const status = useMemo<DriverDispatchStatus>(() => {
    // 'gone' takes priority: we lost the claim race (ConflictError) OR,
    // once we've pinned an intent, the ride started in a non-actionable
    // status or drifted off the pinned status (taken by another driver /
    // cancelled). Guarded by !anySuccess/!anyPending so our own successful
    // transition (which changes the status) doesn't read as 'gone' before
    // we navigate.
    if (claimFailed) return 'gone';
    if (
      subscribedRide !== null &&
      intentStatus !== null &&
      !anySuccess &&
      !anyPending &&
      (action === null || subscribedRide.status !== intentStatus)
    ) {
      return 'gone';
    }
    if (anyPending) return 'accepting';
    if (cannotAcceptReason !== null) return 'cannot_accept';
    // Gate only on the fast reads — user profile + the ride doc. The
    // driver→pickup route is NOT awaited here (it's computed after the
    // claim); this is what makes accept/decline paint immediately.
    if (userQuery.isLoading || subscribedRide === null) {
      return 'loading';
    }
    return 'ready';
  }, [
    claimFailed,
    subscribedRide,
    intentStatus,
    action,
    anyPending,
    anySuccess,
    cannotAcceptReason,
    userQuery.isLoading,
  ]);

  const onAccept = useCallback(() => {
    if (!user || user.role !== 'driver') return;
    if (!subscribedRide) return;
    if (cannotAcceptReason !== null) return;
    if (action === null) return;
    // A claim is already in flight or has already won — ignore repeat taps so
    // the winning driver never fires a second transitionWithClaim that would
    // re-read the now-dispatched doc, miss the awaiting_driver guard, and read
    // as 'Already taken'.
    if (anyPending || anySuccess) return;

    // Begin: the ride is already this driver's (reached from their own
    // Scheduled section). Atomic claim → dispatched, then drop into the
    // monitor flow (which computes + attaches the pickup route).
    if (action === 'begin') {
      beginMutation.mutate(
        { rideId },
        {
          onSuccess: () => {
            setMode('dispatched');
            navigation.replace('DriverMonitor', { rideId: String(rideId) });
          },
          onError: (e: unknown) => {
            if (e instanceof ConflictError) {
              setClaimFailed(true);
              return;
            }
            logger.warn('beginScheduledRide failed', e);
          },
        },
      );
      return;
    }

    // accept / accept_schedule both need a DriverSnapshot.
    if (!user.phone) {
      logger.warn('driver doc missing phone; cannot build DriverSnapshot');
      return;
    }
    if (!user.stripeAccountId) {
      // Covered by cannotAcceptReason above, but TS doesn't narrow through
      // useMemo — re-check for the factory.
      return;
    }
    const snapshotR = DriverSnapshot.create({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phone,
      stripeAccountId: String(user.stripeAccountId),
      pushToken: user.pushToken !== null ? String(user.pushToken) : null,
      avatarUrl: user.avatarUrl,
      vehicle: null,
    });
    if (!snapshotR.ok) {
      logger.warn('DriverSnapshot.create rejected', snapshotR.error);
      return;
    }

    if (action === 'accept_schedule') {
      // No monitor — the accepted scheduled ride lands in the driver's
      // Home Scheduled section. Pop back to Home.
      acceptScheduleMutation.mutate(
        { rideId, driver: snapshotR.value },
        {
          onSuccess: () => {
            navigation.goBack();
          },
          onError: (e: unknown) => {
            if (e instanceof ConflictError) {
              setClaimFailed(true);
              return;
            }
            logger.warn('acceptScheduledRide failed', e);
          },
        },
      );
      return;
    }

    // action === 'accept' (awaiting_driver) — atomic claim, no Google call.
    dispatchMutation.mutate(
      {
        rideId,
        driver: snapshotR.value,
      },
      {
        onSuccess: () => {
          setMode('dispatched');
          // Replace (not push) so back-nav goes to DriverHome rather
          // than bouncing the driver into the now-stale dispatch
          // screen. The status-router inside DriverMonitor renders the
          // appropriate view from the live ride, and
          // useAttachPickupDirections fills in the pickup route.
          navigation.replace('DriverMonitor', { rideId: String(rideId) });
        },
        onError: (e: unknown) => {
          if (e instanceof ConflictError) {
            setClaimFailed(true);
            return;
          }
          logger.warn('dispatchRide failed', e);
        },
      },
    );
  }, [
    user,
    subscribedRide,
    action,
    cannotAcceptReason,
    anyPending,
    anySuccess,
    rideId,
    dispatchMutation,
    acceptScheduleMutation,
    beginMutation,
    setMode,
    navigation,
  ]);

  const onDecline = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return {
    status,
    ride: subscribedRide,
    user,
    driverLocation,
    cannotAcceptReason,
    action,
    onAccept,
    onDecline,
  };
}
