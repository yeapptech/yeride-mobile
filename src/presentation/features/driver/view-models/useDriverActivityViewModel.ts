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
import { queryKeys } from '@presentation/queries/keys';

/**
 * View-model for the driver Activity tab. Mirror of
 * `useActivityViewModel` (rider-side) with the driver use case.
 *
 * Composition:
 *   - `useInfiniteQuery` against `ListRidesByDriver` — paginated history
 *     filtered to rides this driver has accepted (the use case excludes
 *     pre-dispatch `awaiting_driver` rides).
 *   - Status-aware navigation switch — terminal statuses navigate to
 *     `TripDetail`; everything else goes to `DriverMonitor` for the
 *     live trip surface (the status-router inside the screen picks the
 *     right view).
 */

const PAGE_SIZE = 10;

export type DriverActivityVmStatus = 'loading' | 'error' | 'empty' | 'ready';

export interface UseDriverActivityViewModel {
  readonly status: DriverActivityVmStatus;
  readonly rides: readonly Ride[];
  readonly errorMessage: string | null;
  readonly canLoadMore: boolean;
  readonly isLoadingMore: boolean;
  readonly isRefreshing: boolean;
  readonly onLoadMore: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSelectRide: (ride: Ride) => void;
}

export interface DriverActivityNavigator {
  readonly navigateToMonitor: (rideId: string) => void;
  readonly navigateToDetail: (rideId: string) => void;
}

export function useDriverActivityViewModel(args: {
  readonly driverId: UserId | null;
  readonly navigator: DriverActivityNavigator;
}): UseDriverActivityViewModel {
  const { driverId, navigator } = args;
  const useCases = useUseCases();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery<
    RidePage,
    NetworkError,
    InfiniteData<RidePage, RideListCursor | null>,
    readonly unknown[],
    RideListCursor | null
  >({
    queryKey: driverId
      ? ([
          ...queryKeys.ride.listsForDriver(driverId),
          'activity-recent',
        ] as const)
      : (['ride', 'listByDriver', null, 'activity-recent'] as const),
    queryFn: async ({ pageParam }): Promise<RidePage> => {
      if (!driverId) return { rides: [], nextCursor: null };
      const queryArgs: {
        driverId: UserId;
        limit: number;
        cursor?: RideListCursor;
      } = { driverId, limit: PAGE_SIZE };
      if (pageParam) {
        queryArgs.cursor = pageParam;
      }
      const r = await useCases.listRidesByDriver.execute(queryArgs);
      if (!r.ok) throw r.error;
      return r.value;
    },
    initialPageParam: null,
    getNextPageParam: (lastPage): RideListCursor | null => lastPage.nextCursor,
    enabled: driverId !== null,
  });

  const rides = useMemo<readonly Ride[]>(
    () => query.data?.pages.flatMap((p) => p.rides) ?? [],
    [query.data],
  );

  const status: DriverActivityVmStatus = useMemo(() => {
    if (query.isPending && driverId !== null) return 'loading';
    if (query.isError) return 'error';
    if (rides.length === 0) return 'empty';
    return 'ready';
  }, [query.isPending, query.isError, rides.length, driverId]);

  const errorMessage = query.error ? query.error.message : null;

  const onLoadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const onRefresh = useCallback(async (): Promise<void> => {
    if (!driverId) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.ride.listsForDriver(driverId),
    });
  }, [driverId, queryClient]);

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
  };
}
