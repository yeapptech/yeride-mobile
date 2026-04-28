import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { RideService } from '@domain/entities/RideService';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import type { NotFoundError } from '@domain/errors';
import { useUseCases } from '@presentation/di';

import { queryKeys } from './keys';

/**
 * Full service-area catalog. One-shot fetch — the catalog is admin-managed
 * and effectively static within a session. Cached for the entire session
 * by default (`staleTime: Infinity`); call `queryClient.invalidateQueries`
 * if an admin tool refreshes them.
 *
 * Returns `readonly []` when no areas exist; the presentation layer
 * surfaces "we don't operate anywhere yet" rather than a fault state.
 */
export function useServiceAreasQuery(): UseQueryResult<
  readonly ServiceArea[],
  never
> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: queryKeys.serviceArea.list(),
    queryFn: async (): Promise<readonly ServiceArea[]> => {
      const r = await useCases.listServiceAreas.execute();
      // ListServiceAreas returns Result<readonly ServiceArea[], never>, so
      // the `!r.ok` branch is dead by construction — kept for symmetry
      // with other queryFns.
      if (!r.ok) throw r.error as Error;
      return r.value;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Resolve the active service area for a given coordinate. The query key
 * includes the rounded lat/lng so the cache holds one entry per region the
 * user has visited, not one per GPS jitter tick.
 *
 * Returns `null` when the user's location is outside every area (the
 * use case fails with NotFoundError; we translate to `null` here so the
 * UI can branch on the value rather than the error).
 */
export function useActiveServiceAreaQuery(
  point: Coordinates | null,
): UseQueryResult<ServiceArea | null, never> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: point
      ? queryKeys.serviceArea.activeForLocation(point.latitude, point.longitude)
      : ['serviceArea', 'activeForLocation', null],
    queryFn: async (): Promise<ServiceArea | null> => {
      if (!point) return null;
      const r = await useCases.resolveActiveServiceArea.execute(point);
      if (!r.ok) {
        // Use case returns NotFoundError when no area contains the point —
        // semantically that's "no active area", not an error to surface.
        if ((r.error as NotFoundError).code === 'no_service_area_for_point') {
          return null;
        }
        throw r.error;
      }
      return r.value;
    },
    enabled: point !== null,
  });
}

/**
 * Ride-service catalog (Economy, XL, etc.) for a given service area.
 * Static within a session; long stale time.
 */
export function useRideServicesQuery(
  areaId: ServiceAreaId | null,
): UseQueryResult<readonly RideService[], never> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: areaId
      ? queryKeys.serviceArea.rideServices(areaId)
      : ['serviceArea', 'rideServices', null],
    queryFn: async (): Promise<readonly RideService[]> => {
      if (!areaId) return [];
      const r = await useCases.listRideServices.execute(areaId);
      if (!r.ok) throw r.error as Error;
      return r.value;
    },
    enabled: areaId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
