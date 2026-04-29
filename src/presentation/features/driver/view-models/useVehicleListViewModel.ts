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
 *   - `useDeleteVehicleMutation` — soft-deletes; invalidates
 *     `user.current` so the active highlight repaints. Wrapped in
 *     `Alert.alert` confirmation per legacy parity (legacy
 *     `VehicleList.js:63-76`). The mutation only fires after the user
 *     taps "Delete".
 *
 * Card tap behavior (Phase 5 turn 4): pushes `VehicleDetails` with the
 * VIN. Set-active moved to the detail screen. The list card's active
 * highlight is now informational only.
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
  /** True when the delete mutation is in flight. */
  readonly isMutating: boolean;
  /**
   * Tap a vehicle row → push `VehicleDetails` with the VIN. Set-active
   * happens from the detail screen now (turn 4 split).
   */
  onSelectVehicle: (vin: Vin) => void;
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

  const onSelectVehicle = useCallback(
    (vin: Vin) => {
      navigation.navigate('VehicleDetails', { vin: String(vin) });
    },
    [navigation],
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

  const isMutating = deleteMutation.isPending;

  return {
    state,
    isMutating,
    onSelectVehicle,
    onDelete,
    onAddVehicle,
  };
}
