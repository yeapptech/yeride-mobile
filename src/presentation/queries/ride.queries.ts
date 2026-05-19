import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { CreateRideInput } from '@app/usecases/ride/CreateRide';
import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { Route } from '@domain/entities/Route';
import type { UserId } from '@domain/entities/UserId';
import type {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { useUseCases } from '@presentation/di';
// Direct file import (not the hooks barrel) to avoid a require cycle:
// `@presentation/hooks/index.ts` re-exports `useActiveRideForGeofence`,
// which imports back from this file. Bypassing the barrel keeps the
// dependency graph acyclic. (Mirror of the same pattern in
// `useActiveRideForGeofence.ts`.)
import { useUseCaseSubscription } from '@presentation/hooks/useFirestoreSubscription';

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
      // Use cases now return `RidePage`; the legacy callsite shape
      // expected `readonly Ride[]`. The Activity tab is the only caller
      // that needs `nextCursor`; this query (history-only, no
      // pagination) discards it.
      return r.value.rides;
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
      return r.value.rides[0] ?? null;
    },
    enabled: passengerId !== null,
  });
}

/**
 * Driver-side equivalent of `useInProgressRideQuery`. Used by DriverHome
 * to redirect into DriverMonitor when the driver has a ride mid-flight
 * (cold-launch resumption, accidental back-out, etc.).
 *
 * Driver-active statuses are a strict subset of `ACTIVE_STATUSES` — a
 * driver can't be "assigned" to a ride that's still in `awaiting_driver`
 * (no driver yet) or pure `scheduled` (also no driver yet). The driver's
 * trip starts at `scheduled_driver_accepted` / `dispatched`.
 */
const DRIVER_ACTIVE_STATUSES: readonly RideStatus[] = [
  'scheduled_driver_accepted',
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
];

export function useInProgressDriverRideQuery(
  driverId: UserId | null,
): UseQueryResult<Ride | null, NetworkError> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: driverId
      ? queryKeys.ride.listByDriver(driverId, DRIVER_ACTIVE_STATUSES)
      : ['ride', 'listByDriver', null, 'active'],
    queryFn: async (): Promise<Ride | null> => {
      if (!driverId) return null;
      const r = await useCases.listRidesByDriver.execute({
        driverId,
        statuses: DRIVER_ACTIVE_STATUSES,
        limit: 1,
      });
      if (!r.ok) throw r.error;
      return r.value.rides[0] ?? null;
    },
    enabled: driverId !== null,
  });
}

/**
 * Live "rides waiting for a driver" subscription, scoped to the driver's
 * service tiers and current location. Subscription-shaped — wraps the
 * `ListAvailableRides` use case via `useUseCaseSubscription` (same
 * pattern `useRideMonitorViewModel` uses for `ObserveRide`).
 *
 * The subscription is gated by `enabled`: when the driver is offline, or
 * we don't yet have their location / services list, we DON'T subscribe.
 * The hook still has to be called unconditionally (Rules of Hooks); the
 * gate becomes a stable no-op subscriber.
 *
 * Returns `readonly Ride[]` directly. No TanStack Query cache — live
 * subscriptions are a different access pattern (continuous push) and
 * mixing them with TanStack creates two sources of truth. Callers that
 * need the cache equivalent (terminal-state ride list) use
 * `useRidesByPassengerQuery` / `useRidesByDriverQuery`.
 */
export function useAvailableRidesQuery(args: {
  readonly driverId: UserId | null;
  readonly services: readonly RideServiceId[];
  readonly driverLocation: Coordinates | null;
  readonly enabled: boolean;
}): readonly Ride[] {
  const useCases = useUseCases();
  const { driverId, services, driverLocation, enabled } = args;
  const canSubscribe =
    enabled &&
    driverId !== null &&
    driverLocation !== null &&
    services.length > 0;
  return useUseCaseSubscription<
    readonly Ride[],
    {
      driverId: UserId;
      services: readonly RideServiceId[];
      driverLocation: Coordinates;
    }
  >({
    useCase: {
      execute: (
        execArgs: {
          driverId: UserId;
          services: readonly RideServiceId[];
          driverLocation: Coordinates;
        } & { callback: (rides: readonly Ride[]) => void },
      ) => {
        if (!canSubscribe) {
          // No-op subscriber. Emits an empty array once and never again.
          execArgs.callback([]);
          return () => undefined;
        }
        return useCases.listAvailableRides.execute(execArgs);
      },
    },
    args: {
      // Safe casts: when canSubscribe is false the no-op branch above
      // ignores these. When true, the gate guarantees they're non-null.
      driverId: driverId as UserId,
      services,
      driverLocation: driverLocation as Coordinates,
    },
    deps: [
      useCases,
      canSubscribe,
      driverId === null ? null : String(driverId),
      services.map(String).sort().join(','),
      driverLocation?.latitude ?? null,
      driverLocation?.longitude ?? null,
    ],
    initialValue: [],
  });
}

/**
 * Mutation: create a ride from the trip-draft state. The view-model on
 * RouteSelect calls this and navigates to RideMonitor on success.
 *
 * Input is a `CreateRideInput` spec — the use case mints the RideId and
 * builds the `Ride` aggregate. View-models stay free of repo dependencies.
 *
 * On success we (1) seed the byId cache so RideMonitor doesn't double-fetch
 * and (2) invalidate the per-passenger lists so RiderHome reflects the new
 * active ride if the user backs out before navigation lands.
 */
export function useCreateRideMutation(): UseMutationResult<
  Ride,
  ConflictError | ValidationError,
  CreateRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<Ride, ConflictError | ValidationError, CreateRideInput>({
    mutationFn: async (input: CreateRideInput): Promise<Ride> => {
      const r = await useCases.createRide.execute(input);
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

/**
 * Mutation: cancel a ride as the driver. Mirror of
 * `useCancelRideAsRiderMutation` routed through `cancelRideByDriver`. The use
 * case enforces the driver-allowed cancellation-code set
 * (`'passenger_no_show'` is driver-only; `'driver_no_show'` is rejected with
 * a `cancellation_reason_not_driver_allowed` ValidationError).
 *
 * Cache: byId entry is set so DriverMonitor's last-paint shows the cancelled
 * snapshot; both the driver's and passenger's lists are invalidated so the
 * resume queries on either side drop the now-terminal ride.
 */
export function useCancelRideAsDriverMutation(): UseMutationResult<
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
      const r = await useCases.cancelRideByDriver.execute(cancelArgs);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}

/**
 * Mutation: dispatch a ride to this driver — the "Accept" action on
 * DriverDispatch. Wraps `DispatchRide`, which reads the current ride
 * state, runs the entity transition (enforces the `awaiting_driver`
 * precondition), and writes back. If another driver won the race the
 * entity transition fails with a `ride_illegal_transition` ValidationError;
 * the view-model surfaces that as the `'gone'` state.
 *
 * Cache: byId entry is set so DriverMonitor's first paint doesn't double-
 * fetch (Turn 4); driver's lists are invalidated so the in-progress query
 * picks up the freshly-accepted ride; passenger's lists are invalidated
 * so the rider's RideMonitor sees the dispatched snapshot if it doesn't
 * already (their live ObserveRide subscription handles the steady-state
 * case, but invalidation covers any one-shot reads).
 */
export interface DispatchRideInput {
  readonly rideId: RideId;
  readonly driver: DriverSnapshot;
  readonly pickupDirections: Route;
}

export function useDispatchRideMutation(): UseMutationResult<
  Ride,
  NotFoundError | AuthorizationError | ValidationError,
  DispatchRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NotFoundError | AuthorizationError | ValidationError,
    DispatchRideInput
  >({
    mutationFn: async (input: DispatchRideInput): Promise<Ride> => {
      const r = await useCases.dispatchRide.execute(input);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}

/**
 * Mutation: driver picks up the rider. Records pickup-completion odometer
 * and flips server status `dispatched → started`. Direct Firestore write
 * (no Cloud Function — the entity transition is purely local).
 *
 * Cache: byId set so the live `ObserveRide` subscription has nothing to
 * race against on the next paint; both lists invalidated so any one-shot
 * resume queries (driver Activity, rider history) pick up the new status.
 */
export interface StartRideInput {
  readonly rideId: RideId;
  readonly odometerMeters: number;
}

export function useStartRideMutation(): UseMutationResult<
  Ride,
  NotFoundError | AuthorizationError | ValidationError,
  StartRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NotFoundError | AuthorizationError | ValidationError,
    StartRideInput
  >({
    mutationFn: async (input: StartRideInput): Promise<Ride> => {
      const r = await useCases.startRide.execute(input);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}

/**
 * Mutation: driver requests payment. Routes through the `completeTrip`
 * Cloud Function (server-side fare math + auth checks + Stripe charge
 * kickoff). The function flips status to `payment_requested`; the Stripe
 * webhook later flips to `completed` (or `payment_failed`) via a separate
 * path — the live `ObserveRide` subscription delivers either snapshot.
 *
 * Cache: same shape as `useStartRideMutation`. byId set + lists invalidated
 * for both parties so any resume queries reflect the freshly-final state.
 */
export interface RequestPaymentInput {
  readonly rideId: RideId;
  readonly odometerMeters: number;
}

export function useRequestPaymentMutation(): UseMutationResult<
  Ride,
  NetworkError | NotFoundError | AuthorizationError | ValidationError,
  RequestPaymentInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NetworkError | NotFoundError | AuthorizationError | ValidationError,
    RequestPaymentInput
  >({
    mutationFn: async (input: RequestPaymentInput): Promise<Ride> => {
      const r = await useCases.requestPayment.execute(input);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}
