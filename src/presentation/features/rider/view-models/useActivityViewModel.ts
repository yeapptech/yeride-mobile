import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Ride } from '@domain/entities/Ride';
import type { RideListCursor, RidePage } from '@domain/entities/RideListCursor';
import type { UserId } from '@domain/entities/UserId';
import type { NetworkError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import { useScheduledRidesSubscription } from '@presentation/queries';
import { queryKeys } from '@presentation/queries/keys';

/**
 * View-model for the rider Activity tab.
 *
 * Composition:
 *   - `useInfiniteQuery` against `ListRidesByPassenger` — paginated
 *     history via the `RideListCursor` shipped in Phase 10 Turn 6.
 *     `queryKey` keyed on the passenger id; `pageParam` is the cursor
 *     `RideListCursor | null`. `getNextPageParam` reads `nextCursor`
 *     off the last page.
 *   - Status-aware navigation switch — terminal statuses
 *     (`completed` / `cancelled`) navigate to `TripDetail`; everything
 *     else (active rides) navigates to `RideMonitor` so the rider can
 *     follow the live trip. `payment_failed` is intentionally NOT a
 *     terminal in the rewrite — see `RideStatus.isActive()` + the
 *     `useRideMonitorViewModel` docstring — so it routes to
 *     `RideMonitor` (PaymentFailedView lets the rider retry).
 *
 * Why `useInfiniteQuery` over an `onSnapshot` subscription: history
 * doesn't mutate after closure, and pull-to-refresh + tab-focus
 * refetch (TanStack's `refetchOnWindowFocus` default) gives the user
 * a near-live experience without the cursor-pagination edge cases
 * that live subscriptions introduce.
 *
 * The VM exposes flat status / rides / loadMore / refresh / select
 * props so the screen body stays dumb.
 */

const PAGE_SIZE = 10;

export type ActivityVmStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface UseActivityViewModel {
  readonly status: ActivityVmStatus;
  readonly rides: readonly Ride[];
  readonly errorMessage: string | null;
  readonly canLoadMore: boolean;
  readonly isLoadingMore: boolean;
  readonly isRefreshing: boolean;
  readonly onLoadMore: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSelectRide: (ride: Ride) => void;
  /**
   * Live list of the rider's scheduled rides — pending dispatch and
   * post-acceptance-pre-pickup. Phase 10 turn 7. Driven by
   * `ObserveScheduledRides` (rider-side only; the driver Activity tab
   * doesn't surface scheduled rides — legacy parity).
   *
   * Empty array when the rider has no scheduled rides or while the
   * subscription is initializing. Client-side sorted by
   * `schedulePickupAt asc` so "next-soonest" sits on top.
   */
  readonly scheduledRides: readonly Ride[];
}

export interface ActivityNavigator {
  readonly navigateToMonitor: (rideId: string) => void;
  readonly navigateToDetail: (rideId: string) => void;
}

export function useActivityViewModel(args: {
  readonly passengerId: UserId | null;
  readonly navigator: ActivityNavigator;
}): UseActivityViewModel {
  const { passengerId, navigator } = args;
  const useCases = useUseCases();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery<
    RidePage,
    NetworkError,
    InfiniteData<RidePage, RideListCursor | null>,
    readonly unknown[],
    RideListCursor | null
  >({
    queryKey: passengerId
      ? ([
          ...queryKeys.ride.listsForPassenger(passengerId),
          'activity-recent',
        ] as const)
      : (['ride', 'listByPassenger', null, 'activity-recent'] as const),
    queryFn: async ({ pageParam }): Promise<RidePage> => {
      if (!passengerId) {
        return { rides: [], nextCursor: null };
      }
      const queryArgs: {
        passengerId: UserId;
        limit: number;
        cursor?: RideListCursor;
      } = {
        passengerId,
        limit: PAGE_SIZE,
      };
      if (pageParam) {
        queryArgs.cursor = pageParam;
      }
      const r = await useCases.listRidesByPassenger.execute(queryArgs);
      if (!r.ok) throw r.error;
      return r.value;
    },
    initialPageParam: null,
    getNextPageParam: (lastPage): RideListCursor | null => lastPage.nextCursor,
    enabled: passengerId !== null,
  });

  const rides = useMemo<readonly Ride[]>(
    () => query.data?.pages.flatMap((p) => p.rides) ?? [],
    [query.data],
  );

  const status: ActivityVmStatus = useMemo(() => {
    if (query.isPending && passengerId !== null) return 'loading';
    if (query.isError) return 'error';
    if (rides.length === 0) return 'empty';
    return 'ready';
  }, [query.isPending, query.isError, rides.length, passengerId]);

  const errorMessage = query.error ? query.error.message : null;

  const onLoadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const onRefresh = useCallback(async (): Promise<void> => {
    if (!passengerId) return;
    // Reset cached pages so the next read starts from page 1 — the
    // user's "refresh" gesture should not preserve the existing tail.
    await queryClient.invalidateQueries({
      queryKey: queryKeys.ride.listsForPassenger(passengerId),
    });
  }, [passengerId, queryClient]);

  const onSelectRide = useCallback(
    (ride: Ride) => {
      const rideId = String(ride.id);
      if (ride.status === 'completed' || ride.status === 'cancelled') {
        navigator.navigateToDetail(rideId);
      } else {
        navigator.navigateToMonitor(rideId);
      }
    },
    [navigator],
  );

  const scheduledRides = useScheduledRidesSubscription(passengerId);

  return {
    status,
    rides,
    errorMessage,
    canLoadMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
    onLoadMore,
    onRefresh,
    onSelectRide,
    scheduledRides,
  };
}
