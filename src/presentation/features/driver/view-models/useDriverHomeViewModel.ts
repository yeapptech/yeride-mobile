import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { User } from '@domain/entities/User';
import { UserLocation } from '@domain/entities/UserLocation';
import { useCurrentLocation } from '@presentation/hooks';
import type {
  LocationPermission,
  UseCurrentLocation,
} from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceAreaQuery,
  useAvailableRidesQuery,
  useCurrentUserQuery,
  useInProgressDriverRideQuery,
  useRideServicesQuery,
  useUpdateLocationMutation,
} from '@presentation/queries';
import {
  useActiveVehicleId,
  useDriverMode,
  useDriverStatusStore,
  useServiceAreaStore,
} from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('DriverHomeVM');

/**
 * View-model for `DriverHomeScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — the driver's profile. Source of `userId`
 *     and `activeVehicleId` (when present).
 *   - `useCurrentLocation` — foreground GPS read. Phase 7 swaps this
 *     for the background-aware `useGpsLifecycle`.
 *   - `useActiveServiceAreaQuery(coords)` — resolves which service area
 *     the driver is in. Mirrors into `useServiceAreaStore`.
 *   - `useRideServicesQuery(areaId)` — the catalog of services the
 *     driver may receive offers for. Legacy advertises against all
 *     services in the active area; we mirror that.
 *   - `useAvailableRidesQuery(...)` — live subscription gated on
 *     `mode === 'online_idle'`. Returns the queue of rides waiting for a
 *     driver near `coords`.
 *   - `useInProgressDriverRideQuery(driverId)` — auto-redirects to
 *     DriverMonitor when the driver has a ride mid-flight (cold-launch
 *     resumption / accidental back-out). The DriverMonitor status-router
 *     covers every active state, so the redirect target is unconditional.
 *   - `useUpdateLocationMutation` — writes the driver's foreground
 *     location to Firestore so riders' UIs can render driver-side ETA.
 *     Mirrors the rider-home pattern.
 */

export type DriverHomeStatus =
  | 'loading'
  | 'permission_denied'
  | 'out_of_coverage'
  | 'ready';

const VEHICLE_STUB_ID = 'vehicle-stub';

export interface UseDriverHomeViewModel {
  readonly status: DriverHomeStatus;
  readonly user: User | null;
  readonly currentLocation: UseCurrentLocation;
  readonly activeServiceArea: ServiceArea | null;
  readonly mode: ReturnType<typeof useDriverMode>;
  readonly activeVehicleId: string | null;
  readonly availableRides: readonly Ride[];
  readonly inProgressRide: Ride | null;
  readonly permissionStatus: LocationPermission;
  /** Toggle online ↔ offline. Seeds vehicle id on going online. */
  onToggleOnline: () => void;
  /** Tap a ride card → push DriverDispatch with that rideId. */
  onSelectRide: (rideId: string) => void;
  /** Resume an in-progress ride — pushes DriverMonitor with the rideId. */
  onResumeInProgress: (rideId: string) => void;
  /** Re-request location permission and re-read. */
  refreshLocation: () => Promise<void>;
}

export function useDriverHomeViewModel(): UseDriverHomeViewModel {
  const navigation = useNavigation<DriverStackNavigation>();
  const userQuery = useCurrentUserQuery();
  const currentLocation = useCurrentLocation();
  const activeAreaQuery = useActiveServiceAreaQuery(
    currentLocation.coordinates,
  );
  const rideServicesQuery = useRideServicesQuery(
    activeAreaQuery.data?.id ?? null,
  );
  const inProgressRideQuery = useInProgressDriverRideQuery(
    userQuery.data?.id ?? null,
  );
  const updateLocationMutation = useUpdateLocationMutation();
  const setReady = useServiceAreaStore((s) => s.setReady);
  const setActiveArea = useServiceAreaStore((s) => s.setActiveArea);

  const mode = useDriverMode();
  const activeVehicleId = useActiveVehicleId();
  const goOnline = useDriverStatusStore((s) => s.goOnline);
  const goOffline = useDriverStatusStore((s) => s.goOffline);

  const user = userQuery.data ?? null;
  const activeServiceArea = activeAreaQuery.data ?? null;
  const inProgressRide = inProgressRideQuery.data ?? null;

  // The catalog of RideServiceIds the driver advertises for. Legacy
  // advertises against all services in the active area; we mirror that.
  // Memoized on the underlying ids so a fresh array literal each render
  // doesn't churn the available-rides subscription.
  const offeredServices = useMemo<readonly RideServiceId[]>(
    () => (rideServicesQuery.data ?? []).map((s) => s.id),
    [rideServicesQuery.data],
  );

  const availableRides = useAvailableRidesQuery({
    driverId: user?.id ?? null,
    services: offeredServices,
    driverLocation: currentLocation.coordinates,
    enabled: mode === 'online_idle',
  });

  // Mirror the resolved active area into the global store so other
  // surfaces (e.g. DriverDispatch later) can read it without re-querying.
  useEffect(() => {
    if (!activeServiceArea) return;
    setReady([activeServiceArea]);
    setActiveArea(activeServiceArea.id);
  }, [activeServiceArea, setReady, setActiveArea]);

  // Push the driver's location to Firestore on every fresh coordinate
  // read. Foreground only — Phase 7 takes over with the GPS lifecycle.
  // Same dedup ref pattern as `useRiderHomeViewModel`.
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

  // Auto-redirect to the active ride. The status-router inside
  // DriverMonitor handles every active state (en-route, at-pickup,
  // started, payment_requested, payment_failed), so DriverHome doesn't
  // need to branch on status.
  useFocusEffect(
    useCallback(() => {
      if (inProgressRide) {
        navigation.navigate('DriverMonitor', {
          rideId: String(inProgressRide.id),
        });
      }
    }, [inProgressRide, navigation]),
  );

  const onToggleOnline = useCallback(() => {
    if (mode === 'offline') {
      // Driver entity carries `activeVehicleId` (Phase 5 wires the real
      // selection UI). Until then, fall back to a stub so the online
      // toggle works for testers without a registered vehicle.
      const seedId =
        user && user.role === 'driver' && user.activeVehicleId
          ? user.activeVehicleId
          : VEHICLE_STUB_ID;
      goOnline(seedId);
    } else {
      goOffline();
    }
  }, [mode, user, goOnline, goOffline]);

  const onSelectRide = useCallback(
    (rideId: string) => {
      navigation.navigate('DriverDispatch', { rideId });
    },
    [navigation],
  );

  const onResumeInProgress = useCallback(
    (rideId: string) => {
      navigation.navigate('DriverMonitor', { rideId });
    },
    [navigation],
  );

  const status = useMemo<DriverHomeStatus>(() => {
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
    mode,
    activeVehicleId,
    availableRides,
    inProgressRide,
    permissionStatus: currentLocation.permissionStatus,
    onToggleOnline,
    onSelectRide,
    onResumeInProgress,
    refreshLocation: currentLocation.refresh,
  };
}
