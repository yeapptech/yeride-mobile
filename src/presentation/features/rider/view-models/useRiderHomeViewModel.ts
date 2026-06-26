import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import { Endpoint } from '@domain/entities/Endpoint';
import type { Ride } from '@domain/entities/Ride';
import type { SavedPlace } from '@domain/entities/SavedPlace';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { User } from '@domain/entities/User';
import { UserLocation } from '@domain/entities/UserLocation';
import { useCurrentLocation, useWatchedLocation } from '@presentation/hooks';
import type {
  LocationPermission,
  UseCurrentLocation,
} from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceAreaQuery,
  useCurrentUserQuery,
  useInProgressRidesSubscription,
  useScheduledRidesSubscription,
  useUpdateLocationMutation,
} from '@presentation/queries';
import {
  useGpsCurrentLocation,
  useServiceAreaStore,
  useTripDraftStore,
} from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RiderHomeVM');

/**
 * View-model for `RiderHomeScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — the rider's profile / `userId`.
 *   - `useCurrentLocation` — foreground GPS read for the map camera.
 *   - `useActiveServiceAreaQuery(coords)` — resolves the rider's area;
 *     mirrored into `useServiceAreaStore`.
 *   - `useInProgressRidesSubscription(userId, 'rider')` — live list for the
 *     Home In-progress section.
 *   - `useScheduledRidesSubscription(userId)` — live list for the Home
 *     Scheduled section.
 *   - `useUpdateLocationMutation` — writes the rider's location to Firestore.
 *
 * There is intentionally NO auto-route to RideMonitor: the rider lands on
 * Home, sees their active / scheduled rides in the list, and taps a row to
 * open the monitor (`resumeRide`). Removing the old focus-fired redirect is
 * what frees every tab during an active ride (replaces the active-ride
 * banner experiment).
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
  /**
   * Live "you are here" coordinate — the BG-geolocation stream, falling back
   * to the one-shot foreground read before it emits. Drives the map camera +
   * marker so they follow the rider instead of freezing at the mount-time
   * fix. (`currentLocation` stays for the service-area lookup + permission /
   * error banners + the stable Firestore location write.)
   */
  readonly liveLocation: Coordinates | null;
  readonly activeServiceArea: ServiceArea | null;
  /** Live list of the rider's in-progress rides (newest-first). */
  readonly inProgressRides: readonly Ride[];
  /** Live list of the rider's scheduled rides (next-soonest-first). */
  readonly scheduledRides: readonly Ride[];
  /** The rider's saved places (Home / Work / …) for the home quick-rows. */
  readonly savedPlaces: readonly SavedPlace[];
  readonly permissionStatus: LocationPermission;
  /** Tap handler: push to RouteSearch. */
  goToRouteSearch: () => void;
  /** Tap handler: prefill a saved place as the dropoff, then open RouteSearch. */
  goToSavedPlace: (place: SavedPlace) => void;
  /** Tap handler: open a ride's live monitor. */
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
  const updateLocationMutation = useUpdateLocationMutation();
  const setReady = useServiceAreaStore((s) => s.setReady);
  const setActiveArea = useServiceAreaStore((s) => s.setActiveArea);
  const setDropoff = useTripDraftStore((s) => s.setDropoff);

  // Live foreground watch — follows the OS provider directly so the map
  // tracks the rider on the emulator (route playback) + on device, where the
  // BG stream's activity-recognition gate may keep it stationary.
  const watched = useWatchedLocation(
    currentLocation.permissionStatus === 'granted',
  );

  // Read the GPS-store selector unconditionally — a hook can't sit behind a
  // `??` short-circuit (it would stop being called once `watched` emits).
  const gpsLocation = useGpsCurrentLocation();
  // Live coordinate for the map camera + "you are here" marker: foreground
  // watch FIRST (10m, ungated), then the BG stream, then the one-shot read as
  // the cold-start fallback. Watch-first is required: the BG SDK emits one
  // fix then goes quiet behind its 200m filter + activity gate (stationary on
  // the emulator), so a BG-first order would freeze the marker on that stale
  // fix. Kept separate from the stable `currentLocation` read that keys the
  // service-area lookup + Firestore write so those don't churn.
  const liveLocation =
    watched.coordinates ?? gpsLocation ?? currentLocation.coordinates;

  const user = userQuery.data ?? null;
  const activeServiceArea = activeAreaQuery.data ?? null;
  const inProgressRides = useInProgressRidesSubscription(
    user?.id ?? null,
    'rider',
  );
  const scheduledRides = useScheduledRidesSubscription(
    user?.id ?? null,
    'rider',
  );

  // Mirror the resolved active area into the global store so RouteSearch
  // and RouteSelect can read it without re-querying.
  useEffect(() => {
    if (!activeServiceArea) return;
    setReady([activeServiceArea]);
    setActiveArea(activeServiceArea.id);
  }, [activeServiceArea, setReady, setActiveArea]);

  // Push the rider's location to Firestore on every fresh coordinate read.
  const lastWrittenCoordsRef = useRef<Coordinates | null>(null);
  useEffect(() => {
    if (!user || !currentLocation.coordinates) return;
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

  const savedPlaces = useMemo<readonly SavedPlace[]>(
    () => user?.savedPlaces ?? [],
    [user],
  );

  const goToRouteSearch = useCallback(() => {
    navigation.navigate('RouteSearch');
  }, [navigation]);

  const goToSavedPlace = useCallback(
    (place: SavedPlace) => {
      const endpointR = Endpoint.create({
        location: place.address.coordinates,
        address: place.address.label,
        placeName: place.label,
        directions: null,
      });
      if (!endpointR.ok) {
        logger.warn('goToSavedPlace: endpoint build failed', endpointR.error);
        return;
      }
      setDropoff(endpointR.value);
      navigation.navigate('RouteSearch');
    },
    [setDropoff, navigation],
  );

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
    liveLocation,
    activeServiceArea,
    inProgressRides,
    scheduledRides,
    savedPlaces,
    permissionStatus: currentLocation.permissionStatus,
    goToRouteSearch,
    goToSavedPlace,
    resumeRide,
    refreshLocation: currentLocation.refresh,
  };
}
