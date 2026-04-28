import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { User } from '@domain/entities/User';
import { UserLocation } from '@domain/entities/UserLocation';
import { useCurrentLocation } from '@presentation/hooks';
import type {
  LocationPermission,
  UseCurrentLocation,
} from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceAreaQuery,
  useCurrentUserQuery,
  useInProgressRideQuery,
  useUpdateLocationMutation,
} from '@presentation/queries';
import { useServiceAreaStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RiderHomeVM');

/**
 * View-model for `RiderHomeScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — the rider's profile, used as the source of
 *     truth for `userId`. The session store has the id too, but the
 *     query is the single read path.
 *   - `useCurrentLocation` — foreground GPS read. Phase 4 will swap this
 *     for `useGpsLifecycle` once `BackgroundGeolocationClient` lands.
 *   - `useActiveServiceAreaQuery(coords)` — resolves which service area
 *     contains the rider. Pushes the result into `useServiceAreaStore`
 *     so RouteSearch's autocomplete sees the same active area.
 *   - `useInProgressRideQuery(userId)` — auto-redirects to RideMonitor
 *     when the rider has an active ride (resumes after app cold-launch
 *     or accidental back-out).
 *   - `useUpdateLocationMutation` — writes the rider's location to
 *     Firestore so the driver's UI can render rider-side ETA. Throttled
 *     by the adapter's 3-retry backoff; this view-model fires it once
 *     per coordinate read (no polling — that's Phase 4 GPS).
 */

export type RiderHomeStatus =
  | 'loading'
  | 'permission_denied'
  | 'out_of_coverage'
  | 'ready';

export interface UseRiderHomeViewModel {
  readonly status: RiderHomeStatus;
  readonly user: User | null;
  readonly currentLocation: UseCurrentLocation;
  readonly activeServiceArea: ServiceArea | null;
  readonly inProgressRide: Ride | null;
  readonly permissionStatus: LocationPermission;
  /** Tap handler: push to RouteSearch. */
  goToRouteSearch: () => void;
  /** Tap handler: jump back into the active ride. */
  resumeRide: (rideId: string) => void;
  /** Re-request location permission and re-read. */
  refreshLocation: () => Promise<void>;
}

export function useRiderHomeViewModel(): UseRiderHomeViewModel {
  const navigation = useNavigation<RiderStackNavigation>();
  const userQuery = useCurrentUserQuery();
  const currentLocation = useCurrentLocation();
  const activeAreaQuery = useActiveServiceAreaQuery(
    currentLocation.coordinates,
  );
  const inProgressRideQuery = useInProgressRideQuery(
    userQuery.data?.id ?? null,
  );
  const updateLocationMutation = useUpdateLocationMutation();
  const setReady = useServiceAreaStore((s) => s.setReady);
  const setActiveArea = useServiceAreaStore((s) => s.setActiveArea);

  const user = userQuery.data ?? null;
  const activeServiceArea = activeAreaQuery.data ?? null;
  const inProgressRide = inProgressRideQuery.data ?? null;

  // Mirror the resolved active area into the global store so RouteSearch
  // and RouteSelect can read it without re-querying. Defensive: if there
  // are no other areas seeded, still write the singleton.
  useEffect(() => {
    if (!activeServiceArea) return;
    setReady([activeServiceArea]);
    setActiveArea(activeServiceArea.id);
  }, [activeServiceArea, setReady, setActiveArea]);

  // Push the rider's location to Firestore on every fresh coordinate read.
  // No polling — Phase 4 takes over with the GPS lifecycle.
  const lastWrittenCoordsRef = useRef<Coordinates | null>(null);
  useEffect(() => {
    if (!user || !currentLocation.coordinates) return;
    // Skip identical reads (the hook can re-emit the same coords on
    // re-mount). Real dedup against jitter waits for Phase 4.
    if (
      lastWrittenCoordsRef.current &&
      lastWrittenCoordsRef.current.equals(currentLocation.coordinates)
    ) {
      return;
    }
    const locationR = UserLocation.create({
      userId: user.id,
      location: currentLocation.coordinates,
      speed: null,
      updatedAt: new Date(),
      tripTracking: null,
    });
    if (!locationR.ok) {
      logger.warn('updateLocation: build failed', locationR.error);
      return;
    }
    lastWrittenCoordsRef.current = currentLocation.coordinates;
    updateLocationMutation.mutate(locationR.value, {
      onError: (e: unknown) => {
        logger.warn('updateLocation: mutation failed', e);
      },
    });
  }, [user, currentLocation.coordinates, updateLocationMutation]);

  // Auto-redirect to RideMonitor if there's an in-progress ride. We use
  // `useFocusEffect` so the redirect fires every time RiderHome gains
  // focus — including after the user backs out of RideMonitor without
  // completing the ride.
  useFocusEffect(
    useCallback(() => {
      if (inProgressRide) {
        navigation.replace('RideMonitor', {
          rideId: String(inProgressRide.id),
        });
      }
    }, [inProgressRide, navigation]),
  );

  const goToRouteSearch = useCallback(() => {
    navigation.navigate('RouteSearch');
  }, [navigation]);

  const resumeRide = useCallback(
    (rideId: string) => {
      navigation.navigate('RideMonitor', { rideId });
    },
    [navigation],
  );

  const status = useMemo<RiderHomeStatus>(() => {
    if (currentLocation.permissionStatus === 'denied') {
      return 'permission_denied';
    }
    if (
      currentLocation.permissionStatus === 'undetermined' ||
      currentLocation.permissionStatus === 'requesting' ||
      userQuery.isLoading
    ) {
      return 'loading';
    }
    if (
      activeAreaQuery.data === null &&
      activeAreaQuery.isFetched &&
      currentLocation.coordinates !== null
    ) {
      return 'out_of_coverage';
    }
    return 'ready';
  }, [
    currentLocation.permissionStatus,
    currentLocation.coordinates,
    userQuery.isLoading,
    activeAreaQuery.data,
    activeAreaQuery.isFetched,
  ]);

  return {
    status,
    user,
    currentLocation,
    activeServiceArea,
    inProgressRide,
    permissionStatus: currentLocation.permissionStatus,
    goToRouteSearch,
    resumeRide,
    refreshLocation: currentLocation.refresh,
  };
}
