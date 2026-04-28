import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { UserId } from '@domain/entities/UserId';
import type {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { useUseCases } from '@presentation/di';

import { queryKeys } from './keys';

/**
 * Active-ride statuses — anything that's still in flight (not terminal).
 * Used by `useInProgressRideQuery` to filter the passenger's history down
 * to the one (or zero) ride RiderHome should resume into.
 *
 * `payment_failed` is included intentionally: the rider needs to land back
 * on RideMonitor's PaymentFailedView to retry the charge (Phase 6 wires
 * the retry; Phase 3 just shows the screen).
 */
const ACTIVE_STATUSES: readonly RideStatus[] = [
  'awaiting_driver',
  'scheduled',
  'scheduled_driver_accepted',
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
];

/**
 * One-shot read of a ride by id.
 *
 * Why not always go through the live `ObserveRide` subscription? Two
 * reasons:
 *   1. The receipt screen is read-only against a terminal state — once a
 *      ride is `completed` or `cancelled`, no more updates come through.
 *      A query is cheaper than a subscription that emits once and idles.
 *   2. Deep-link handlers need the ride synchronously before deciding
 *      which screen to mount. `useQuery` integrates with Suspense;
 *      `useFirestoreSubscription` doesn't.
 */
export function useRideQuery(
  rideId: RideId | null,
): UseQueryResult<Ride, NotFoundError> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: rideId ? queryKeys.ride.byId(rideId) : ['ride', 'byId', null],
    queryFn: async (): Promise<Ride> => {
      // queryFn only runs when `enabled` is true (rideId !== null), but
      // narrow defensively.
      if (!rideId) {
        throw new Error('rideId required');
      }
      const r = await useCases.getRideById.execute(rideId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: rideId !== null,
    // Rides are mostly-static once terminal; refetch on focus is wasteful.
    // The view-models that need live updates use `useUseCaseSubscription`
    // against `ObserveRide` instead.
    refetchOnWindowFocus: false,
  });
}

/**
 * Passenger-scoped ride list, narrowable by status set. Used by:
 *   - `useInProgressRideQuery` (alias below) — for RiderHome resumption.
 *   - Future Activity tab — for the rider's history (Phase 5 wires it).
 */
export function useRidesByPassengerQuery(args: {
  readonly passengerId: UserId | null;
  readonly statuses?: readonly RideStatus[];
  readonly limit?: number;
}): UseQueryResult<readonly Ride[], NetworkError> {
  const useCases = useUseCases();
  const { passengerId, statuses, limit } = args;
  return useQuery({
    queryKey: passengerId
      ? queryKeys.ride.listByPassenger(passengerId, statuses)
      : ['ride', 'listByPassenger', null, null],
    queryFn: async (): Promise<readonly Ride[]> => {
      if (!passengerId) return [];
      const queryArgs: {
        passengerId: UserId;
        statuses?: readonly RideStatus[];
        limit?: number;
      } = { passengerId };
      if (statuses !== undefined) queryArgs.statuses = statuses;
      if (limit !== undefined) queryArgs.limit = limit;
      const r = await useCases.listRidesByPassenger.execute(queryArgs);
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: passengerId !== null,
  });
}

/**
 * The single in-progress ride for a passenger, or `null` if there isn't one.
 * Used by RiderHome to decide whether to push the user back into RideMonitor.
 *
 * Returns `null` (not undefined / not throw) when the list is empty —
 * "no in-progress ride" is the expected steady state.
 */
export function useInProgressRideQuery(
  passengerId: UserId | null,
): UseQueryResult<Ride | null, NetworkError> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: passengerId
      ? queryKeys.ride.listByPassenger(passengerId, ACTIVE_STATUSES)
      : ['ride', 'listByPassenger', null, 'active'],
    queryFn: async (): Promise<Ride | null> => {
      if (!passengerId) return null;
      const r = await useCases.listRidesByPassenger.execute({
        passengerId,
        statuses: ACTIVE_STATUSES,
        limit: 1,
      });
      if (!r.ok) throw r.error;
      return r.value[0] ?? null;
    },
    enabled: passengerId !== null,
  });
}

/**
 * Mutation: create a ride from the trip-draft state. The view-model on
 * RouteSelect calls this and navigates to RideMonitor on success.
 *
 * On success we (1) seed the byId cache so RideMonitor doesn't double-fetch
 * and (2) invalidate the per-passenger lists so RiderHome reflects the new
 * active ride if the user backs out before navigation lands.
 */
export function useCreateRideMutation(): UseMutationResult<
  Ride,
  ConflictError | ValidationError,
  Ride
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<Ride, ConflictError | ValidationError, Ride>({
    mutationFn: async (ride: Ride): Promise<Ride> => {
      const r = await useCases.createRide.execute(ride);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}

/**
 * Mutation: cancel a ride as the rider. Carries the cancel reason and
 * (optional) odometer; the Cloud Function computes any cancellation fee
 * and writes the cancellation row.
 *
 * Cache: we update the byId entry and invalidate the per-passenger lists
 * so RideMonitor receives a `cancelled` snapshot via the live subscription
 * and RiderHome drops the ride from its in-progress query.
 */
export interface CancelRideInput {
  readonly rideId: RideId;
  readonly reason: CancellationReason;
  readonly odometerMeters?: number;
}

export function useCancelRideAsRiderMutation(): UseMutationResult<
  Ride,
  NetworkError | NotFoundError | AuthorizationError | ValidationError,
  CancelRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NetworkError | NotFoundError | AuthorizationError | ValidationError,
    CancelRideInput
  >({
    mutationFn: async (input: CancelRideInput): Promise<Ride> => {
      const cancelArgs: {
        rideId: RideId;
        reason: CancellationReason;
        odometerMeters?: number;
      } = {
        rideId: input.rideId,
        reason: input.reason,
      };
      if (input.odometerMeters !== undefined) {
        cancelArgs.odometerMeters = input.odometerMeters;
      }
      const r = await useCases.cancelRideByRider.execute(cancelArgs);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}
