import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { User } from '@domain/entities/User';
import { UserLocation } from '@domain/entities/UserLocation';
import type { Vehicle } from '@domain/entities/Vehicle';
import { useCurrentLocation, useOpenSettings } from '@presentation/hooks';
import type {
  LocationPermission,
  UseCurrentLocation,
} from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceAreaQuery,
  useAvailableRidesQuery,
  useCurrentUserQuery,
  useDriverActiveVehicleQuery,
  useInProgressRidesSubscription,
  useRideServicesQuery,
  useUpdateLocationMutation,
} from '@presentation/queries';
import {
  useActiveVehicleId,
  useDriverMode,
  useDriverStatusStore,
  useGpsPermissionStatus,
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
 *   - `useInProgressRidesSubscription(driverId, 'driver')` — live list of
 *     the driver's currently-happening rides for the Home In-progress
 *     section. No auto-redirect: the driver taps a row to open
 *     DriverMonitor (`onResumeInProgress`).
 *   - `useUpdateLocationMutation` — writes the driver's foreground
 *     location to Firestore so riders' UIs can render driver-side ETA.
 *     Mirrors the rider-home pattern.
 */

export type DriverHomeStatus =
  | 'loading'
  | 'permission_denied'
  | 'out_of_coverage'
  | 'ready';

export interface UseDriverHomeViewModel {
  readonly status: DriverHomeStatus;
  readonly user: User | null;
  readonly currentLocation: UseCurrentLocation;
  readonly activeServiceArea: ServiceArea | null;
  readonly mode: ReturnType<typeof useDriverMode>;
  readonly activeVehicleId: string | null;
  /**
   * The driver's active Vehicle aggregate, resolved via
   * `useDriverActiveVehicleQuery`. `null` when no active vehicle is
   * registered (the empty-state branch) or while the read is in flight.
   * Powers the DriverHome stock-photo header.
   */
  readonly activeVehicle: Vehicle | null;
  /**
   * True when the driver has no active vehicle registered. The
   * DriverHome screen surfaces an empty-state prompt routing to
   * `Vehicles` instead of the online toggle.
   */
  readonly noActiveVehicle: boolean;
  readonly availableRides: readonly Ride[];
  readonly inProgressRides: readonly Ride[];
  readonly permissionStatus: LocationPermission;
  /**
   * Phase 9 turn 10. True when the BACKGROUND-geolocation SDK
   * permission has been explicitly denied (`useGpsStore.permissionStatus
   * === 'denied'`). Distinct from `permissionStatus` above (which is
   * `useCurrentLocation`'s foreground permission). The screen surfaces
   * a `<PermissionDeniedBanner/>` and disables the online toggle when
   * this is true, so a driver doesn't go online without GPS. The
   * `'undetermined'` state is intentionally NOT covered here —
   * `useGpsLifecycle` will fire the OS dialog soon, and
   * `Linking.openSettings()` is the wrong CTA before the user has
   * been asked.
   */
  readonly bgPermissionDenied: boolean;
  /**
   * Toggle online ↔ offline. No-op when `noActiveVehicle === true` OR
   * `bgPermissionDenied === true` — the screen guards the affordance,
   * but the VM is the authoritative gate (defense in depth).
   */
  onToggleOnline: () => void;
  /** Tap a ride card → push DriverDispatch with that rideId. */
  onSelectRide: (rideId: string) => void;
  /** Resume an in-progress ride — pushes DriverMonitor with the rideId. */
  onResumeInProgress: (rideId: string) => void;
  /** Push the Vehicles screen so the driver can register their first vehicle. */
  onRegisterVehicle: () => void;
  /** Re-request location permission and re-read. */
  refreshLocation: () => Promise<void>;
  /**
   * Phase 9 turn 10. Open the OS app-settings page so the driver can
   * grant location permission. Wraps `Linking.openSettings()`.
   */
  onOpenSettings: () => void;
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
  const activeVehicleQuery = useDriverActiveVehicleQuery();
  const updateLocationMutation = useUpdateLocationMutation();
  const setReady = useServiceAreaStore((s) => s.setReady);
  const setActiveArea = useServiceAreaStore((s) => s.setActiveArea);

  const mode = useDriverMode();
  const activeVehicleId = useActiveVehicleId();
  const goOnline = useDriverStatusStore((s) => s.goOnline);
  const goOffline = useDriverStatusStore((s) => s.goOffline);
  const bgPermissionStatus = useGpsPermissionStatus();
  const onOpenSettings = useOpenSettings();

  const user = userQuery.data ?? null;
  const activeServiceArea = activeAreaQuery.data ?? null;
  const inProgressRides = useInProgressRidesSubscription(
    user?.id ?? null,
    'driver',
  );

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

  // Phase 5 turn 4: the `activeVehicleId` is now real — drivers must
  // register a vehicle before going online. The legacy `'vehicle-stub'`
  // fallback is gone. When no active vehicle is registered, the screen
  // hides the online toggle entirely; the VM additionally guards the
  // callback so a stale press handler can't sneak through.
  const bgPermissionDenied = bgPermissionStatus === 'denied';

  const onToggleOnline = useCallback(() => {
    if (mode === 'offline') {
      if (!user || user.role !== 'driver' || user.activeVehicleId === null) {
        // Defense in depth: the screen should hide the toggle in this
        // case, but never trust the UI to be the only gate.
        return;
      }
      if (bgPermissionDenied) {
        // Phase 9 turn 10. Driver can't go online without GPS — the
        // screen disables the toggle, but the VM is the authoritative
        // gate. Going online would just sit there with no SDK firing
        // location pushes / geofence events.
        return;
      }
      goOnline(user.activeVehicleId);
    } else {
      goOffline();
    }
  }, [mode, user, bgPermissionDenied, goOnline, goOffline]);

  const onRegisterVehicle = useCallback(() => {
    navigation.navigate('Vehicles');
  }, [navigation]);

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

  const noActiveVehicle =
    user !== null && user.role === 'driver' && user.activeVehicleId === null;

  return {
    status,
    user,
    currentLocation,
    activeServiceArea,
    mode,
    activeVehicleId,
    activeVehicle: activeVehicleQuery.data ?? null,
    noActiveVehicle,
    availableRides,
    inProgressRides,
    permissionStatus: currentLocation.permissionStatus,
    bgPermissionDenied,
    onToggleOnline,
    onSelectRide,
    onResumeInProgress,
    onRegisterVehicle,
    refreshLocation: currentLocation.refresh,
    onOpenSettings,
  };
}
