import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import { useUseCases } from '@presentation/di';
import { useFirestoreSubscription } from '@presentation/hooks';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useCurrentUserQuery,
  useDeleteVehicleMutation,
  useSetActiveVehicleMutation,
} from '@presentation/queries';
import { LOG } from '@shared/logger';

const logger = LOG.extend('VehicleListVM');

/**
 * View-model for `VehicleListScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — reads the driver's `activeVehicleId` and
 *     `id`. The `id` becomes the `driverId` arg for the subscription.
 *   - `useFirestoreSubscription` over `ListDriverVehicles.subscribe(...)`
 *     — live list of the driver's vehicles. The repo emits the current
 *     state synchronously on subscribe so we paint without an extra
 *     fetch round-trip. Sorted by `createdAt desc` at the repo layer.
 *   - `useSetActiveVehicleMutation` — flips active pointer; invalidates
 *     `user.current` so the active highlight repaints.
 *   - `useDeleteVehicleMutation` — soft-deletes; same invalidation. We
 *     wrap the call in `Alert.alert` confirmation per legacy parity
 *     (legacy `VehicleList.js:63-76`). The mutation only fires after
 *     the user taps "Delete".
 *
 * State machine is a tagged union — same shape pattern as the driver
 * status-router VMs:
 *
 *   { kind: 'loading' }    — user not loaded yet
 *   { kind: 'empty' }      — user loaded, list emitted, list is empty
 *   { kind: 'ready', vehicles, activeVin } — list has at least one entry
 *   { kind: 'error', error } — useCurrentUserQuery failed
 *
 * Active vehicle source-of-truth: `user.activeVehicleId` from the
 * Firestore user doc, NOT the Zustand `useDriverStatusStore` (which only
 * tracks the active VIN while the driver is online — it's a UI mirror,
 * not the persisted truth). After mutations succeed we invalidate the
 * user query so the next read sees the new active pointer.
 */

export type VehicleListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly vehicles: readonly Vehicle[];
      readonly activeVin: string | null;
    }
  | { readonly kind: 'error'; readonly error: Error };

export interface UseVehicleListViewModel {
  readonly state: VehicleListState;
  /** True when a setActive or delete mutation is in flight. */
  readonly isMutating: boolean;
  /** Activate the named vehicle. No-op if the VIN is already active. */
  onActivate: (vin: Vin) => void;
  /**
   * Delete a vehicle. Pops a confirmation Alert before firing the
   * mutation; the user must explicitly tap "Delete". `onDelete` is wired
   * through `Alert.alert` rather than gesture-handler swipe so it's
   * naturally testable via `jest.spyOn(Alert, 'alert')`.
   */
  onDelete: (vin: Vin, vehicleLabel: string) => void;
  /** Push the registration screen. */
  onAddVehicle: () => void;
}

export function useVehicleListViewModel(): UseVehicleListViewModel {
  const navigation = useNavigation<DriverStackNavigation>();
  const useCases = useUseCases();
  const userQuery = useCurrentUserQuery();
  const setActiveMutation = useSetActiveVehicleMutation();
  const deleteMutation = useDeleteVehicleMutation();

  const driverId = userQuery.data?.role === 'driver' ? userQuery.data.id : null;

  // Subscribe to the live list. When `driverId` is null (loading or rider
  // role), we hand the hook a no-op subscriber so the hook still mounts
  // safely (Rules of Hooks) and the snapshot stays the initial empty array.
  const vehicles = useFirestoreSubscription<readonly Vehicle[]>(
    useCallback(
      (cb) => {
        if (driverId === null) {
          cb([]);
          return () => undefined;
        }
        return useCases.listDriverVehicles.subscribe({
          driverId,
          callback: cb,
        });
      },
      [useCases, driverId],
    ),
    [],
  );

  const activeVin =
    userQuery.data?.role === 'driver' ? userQuery.data.activeVehicleId : null;

  const onActivate = useCallback(
    (vin: Vin) => {
      if (String(vin) === activeVin) return;
      setActiveMutation.mutate(
        { vin },
        {
          onError: (error) => {
            logger.warn('setActive mutation failed', error);
          },
        },
      );
    },
    [activeVin, setActiveMutation],
  );

  const onDelete = useCallback(
    (vin: Vin, vehicleLabel: string) => {
      Alert.alert(
        'Delete vehicle',
        `Remove ${vehicleLabel} from your account?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteMutation.mutate(
                { vin },
                {
                  onError: (
                    error: AuthorizationError | NotFoundError | ValidationError,
                  ) => {
                    logger.warn('delete mutation failed', error);
                  },
                },
              );
            },
          },
        ],
      );
    },
    [deleteMutation],
  );

  const onAddVehicle = useCallback(() => {
    navigation.navigate('VehicleRegistration');
  }, [navigation]);

  let state: VehicleListState;
  if (userQuery.isLoading) {
    state = { kind: 'loading' };
  } else if (userQuery.isError) {
    state = { kind: 'error', error: userQuery.error };
  } else if (driverId === null) {
    // User loaded but isn't a driver. Shouldn't happen if the navigator
    // gates this screen properly, but rendering as empty is the safe
    // fallback rather than crashing.
    state = { kind: 'empty' };
  } else if (vehicles.length === 0) {
    state = { kind: 'empty' };
  } else {
    state = { kind: 'ready', vehicles, activeVin };
  }

  const isMutating = setActiveMutation.isPending || deleteMutation.isPending;

  return {
    state,
    isMutating,
    onActivate,
    onDelete,
    onAddVehicle,
  };
}
