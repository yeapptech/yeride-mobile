import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import type { Vehicle } from '@domain/entities/Vehicle';
import { Vin } from '@domain/entities/Vin';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useCurrentUserQuery,
  useDeleteVehicleMutation,
  useSetActiveVehicleMutation,
  useVehicleQuery,
} from '@presentation/queries';
import { LOG } from '@shared/logger';

const logger = LOG.extend('VehicleDetailsVM');

/**
 * View-model for `VehicleDetailsScreen`.
 *
 * Composes:
 *   - `useVehicleQuery(vin)` — one-shot read of the vehicle. Same hook
 *     `VehiclePhotos` consumes; the byVin invalidation from
 *     `UploadVehiclePhotos` repaints both screens when the user pops
 *     back from photos to details.
 *   - `useCurrentUserQuery` — used to derive `isActive` (the driver's
 *     `activeVehicleId` matches this VIN).
 *   - `useSetActiveVehicleMutation` — flips the active pointer. Only
 *     reachable when `canSetActive === true` (vehicle approved AND not
 *     already active).
 *   - `useDeleteVehicleMutation` — soft-deletes. Wrapped in
 *     `Alert.alert` confirmation, mirroring the legacy / list VM
 *     pattern. On success we pop back so the user lands on the
 *     refreshed list.
 *
 * State machine (tagged union):
 *
 *   { kind: 'loading' }                — vehicle fetch in flight
 *   { kind: 'error',   error }         — vehicle fetch failed (NotFound)
 *   { kind: 'ready',
 *     vehicle, isActive, canSetActive } — happy path
 *
 * `canSetActive` is `vehicle.status === 'approved' && !isActive`. The
 * UI hides the "Set as active" button when the predicate is false.
 *
 * The mutation in-flight indicator is exposed as `isMutating` for the
 * screen to disable buttons / show spinners during transitions.
 */

export type VehicleDetailsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: Error }
  | {
      readonly kind: 'ready';
      readonly vehicle: Vehicle;
      readonly isActive: boolean;
      readonly canSetActive: boolean;
    };

export interface UseVehicleDetailsViewModel {
  readonly state: VehicleDetailsState;
  readonly isMutating: boolean;
  /** Flip the active pointer to this vehicle. No-op if already active. */
  onSetActive: () => void;
  /** Pop a confirmation Alert; tap "Delete" to fire the soft-delete. */
  onDelete: () => void;
  /** Push the photos screen with this VIN. */
  onEditPhotos: () => void;
  /** Pop back to the previous screen (typically VehicleList). */
  onBack: () => void;
}

export function useVehicleDetailsViewModel(args: {
  readonly vin: string;
}): UseVehicleDetailsViewModel {
  const navigation = useNavigation<DriverStackNavigation>();

  const vinR = Vin.create(args.vin);
  const vin = vinR.ok ? vinR.value : null;

  const vehicleQuery = useVehicleQuery(vin);
  const userQuery = useCurrentUserQuery();
  const setActiveMutation = useSetActiveVehicleMutation();
  const deleteMutation = useDeleteVehicleMutation();

  const onSetActive = useCallback(() => {
    if (!vin || !vehicleQuery.data) return;
    if (vehicleQuery.data.status !== 'approved') return;
    setActiveMutation.mutate(
      { vin },
      {
        onError: (error) => {
          logger.warn('setActive failed', error);
        },
      },
    );
  }, [vin, vehicleQuery.data, setActiveMutation]);

  const onDelete = useCallback(() => {
    if (!vin || !vehicleQuery.data) return;
    const vehicle = vehicleQuery.data;
    const label = `${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`;
    Alert.alert('Delete vehicle', `Remove ${label} from your account?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteMutation.mutate(
            { vin },
            {
              onSuccess: () => {
                navigation.goBack();
              },
              onError: (error) => {
                logger.warn('delete failed', error);
              },
            },
          );
        },
      },
    ]);
  }, [vin, vehicleQuery.data, deleteMutation, navigation]);

  const onEditPhotos = useCallback(() => {
    if (!vin) return;
    navigation.navigate('VehiclePhotos', { vin: String(vin) });
  }, [vin, navigation]);

  const onBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  let state: VehicleDetailsState;
  if (!vin) {
    state = { kind: 'error', error: new Error(`Invalid VIN: ${args.vin}`) };
  } else if (vehicleQuery.isLoading || userQuery.isLoading) {
    state = { kind: 'loading' };
  } else if (vehicleQuery.isError) {
    state = { kind: 'error', error: vehicleQuery.error };
  } else if (!vehicleQuery.data) {
    state = { kind: 'loading' };
  } else {
    const vehicle = vehicleQuery.data;
    const activeVehicleId =
      userQuery.data?.role === 'driver' ? userQuery.data.activeVehicleId : null;
    const isActive = activeVehicleId === String(vehicle.vin);
    const canSetActive = vehicle.status === 'approved' && !isActive;
    state = { kind: 'ready', vehicle, isActive, canSetActive };
  }

  const isMutating = setActiveMutation.isPending || deleteMutation.isPending;

  return {
    state,
    isMutating,
    onSetActive,
    onDelete,
    onEditPhotos,
    onBack,
  };
}
