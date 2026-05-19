import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { TripPayment } from '@domain/entities/TripPayment';
import type { NotFoundError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import { queryKeys } from '@presentation/queries/keys';

/**
 * View-model for `TripDetailScreen` — the role-agnostic trip-detail
 * surface reached from Activity tab row taps on terminal-status trips
 * (`completed` / `cancelled`).
 *
 * Composition:
 *   - `useQuery(GetRideById)` — one-shot fetch. The trip is terminal
 *     so a live subscription would be wasteful (no updates expected).
 *     Cached under `queryKeys.ride.byId` so navigating between
 *     activity ↔ detail doesn't double-fetch.
 *   - `useFirestoreSubscription(ObserveTripEvents)` — events are
 *     append-only; a subscription is fine and matches the legacy
 *     `Events.js` shape.
 *   - `useFirestoreSubscription(ObserveTripPayments)` — payments can
 *     still mutate post-trip if the rider tips later, so we keep a
 *     live subscription. The legacy `TransactionHistory.js` did the
 *     same.
 *
 * Output is flat: `{ status, ride, events, payments, errorMessage }`
 * with a discriminated union over `status` ('loading' | 'not-found' |
 * 'error' | 'ready'). The screen body stays dumb.
 *
 * `viewerRole` is computed by the consumer (the navigator already
 * routes from the rider Activity tab vs the driver Activity tab,
 * giving us role context) and passed through as a render-prop. We
 * don't infer it from the ride — a driver scrolling old trips that
 * pre-date their current role still gets the driver-side view.
 */

export type TripDetailVmStatus = 'loading' | 'not-found' | 'error' | 'ready';

export interface UseTripDetailViewModel {
  readonly status: TripDetailVmStatus;
  readonly ride: Ride | null;
  readonly events: readonly TripEvent[];
  readonly payments: readonly TripPayment[];
  readonly errorMessage: string | null;
  readonly refresh: () => Promise<void>;
}

export function useTripDetailViewModel(args: {
  readonly rideId: RideId;
}): UseTripDetailViewModel {
  const { rideId } = args;
  const useCases = useUseCases();

  // ── One-shot ride read ────────────────────────────────────────────
  const rideQuery: UseQueryResult<Ride, NotFoundError> = useQuery<
    Ride,
    NotFoundError
  >({
    queryKey: queryKeys.ride.byId(rideId),
    queryFn: async (): Promise<Ride> => {
      const r = await useCases.getRideById.execute(rideId);
      if (!r.ok) throw r.error;
      return r.value;
    },
    refetchOnWindowFocus: false,
  });

  // ── Live events subscription ──────────────────────────────────────
  const subscribeEvents = useCallback(
    (cb: (events: readonly TripEvent[]) => void) =>
      useCases.observeTripEvents.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const events = useFirestoreSubscription<readonly TripEvent[]>(
    subscribeEvents,
    [],
  );

  // ── Live payments subscription ────────────────────────────────────
  const subscribePayments = useCallback(
    (cb: (payments: readonly TripPayment[]) => void) =>
      useCases.observeTripPayments.execute({ rideId, callback: cb }),
    [useCases, rideId],
  );
  const payments = useFirestoreSubscription<readonly TripPayment[]>(
    subscribePayments,
    [],
  );

  const status: TripDetailVmStatus = useMemo(() => {
    if (rideQuery.isPending) return 'loading';
    if (rideQuery.isError) {
      // GetRideById only yields NotFoundError; map to a separate state
      // so the screen can render a dedicated "trip not found" message.
      const err = rideQuery.error;
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        typeof (err as { code: unknown }).code === 'string' &&
        (err as { code: string }).code === 'ride_not_found'
      ) {
        return 'not-found';
      }
      return 'error';
    }
    return 'ready';
  }, [rideQuery.isPending, rideQuery.isError, rideQuery.error]);

  const errorMessage = rideQuery.error ? rideQuery.error.message : null;

  const refresh = useCallback(async (): Promise<void> => {
    await rideQuery.refetch();
  }, [rideQuery]);

  return {
    status,
    ride: rideQuery.data ?? null,
    events,
    payments,
    errorMessage,
    refresh,
  };
}
