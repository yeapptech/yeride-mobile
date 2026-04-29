import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';

import type { Vehicle } from '@domain/entities/Vehicle';
import {
  VEHICLE_PHOTO_TYPES,
  type VehiclePhotoType,
} from '@domain/entities/VehiclePhotoType';
import { Vin } from '@domain/entities/Vin';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useUploadVehiclePhotosMutation,
  useVehicleQuery,
} from '@presentation/queries';
import { LOG } from '@shared/logger';

const logger = LOG.extend('VehiclePhotosVM');

/**
 * View-model for `VehiclePhotosScreen`.
 *
 * Composes:
 *   - `useVehicleQuery(vin)` — one-shot read of the live vehicle. The
 *     `photos` map on the entity is the source of truth for the
 *     "attached" state; we don't mirror URLs into a local state map.
 *   - `useUploadVehiclePhotosMutation` — single mutation hook reused for
 *     every tile via `mutateAsync`. Per-tile isolation is achieved with
 *     local `inFlight` + `errors` records (keyed on `VehiclePhotoType`)
 *     rather than 5 hardcoded hooks. The mutation invalidates
 *     `vehicle.byVin(vin)` on success so the next render derives
 *     `attached` from fresh data.
 *
 * Per-tile state (a tagged union, derived per render):
 *
 *   idle      — no photo, no upload in flight, no error
 *   attached  — `vehicle.photos[type]` is non-null and no upload is in
 *               flight (a fresh upload that just landed reaches this
 *               state once the byVin invalidation refetches)
 *   uploading — `inFlight[type]` is true (single-tile mutation in flight)
 *   error     — `errors[type]` is set; the user must dismiss before the
 *               tile re-enables for re-pick (`onClearError`)
 *
 * Picker:
 *   - `expo-image-picker` library picker, `quality: 0.7`,
 *     `allowsEditing: false`. Camera fallback isn't surfaced this turn —
 *     adds friction without enough payoff. Phase 9 polish can layer it.
 *   - Cancellation is silent: returns to whatever state we were in.
 *   - Permission errors (denied) surface as a tile error so the user
 *     sees what happened.
 *
 * Ownership and authorization are enforced by `UploadVehiclePhotos`
 * itself — the VM doesn't pre-check. An `AuthorizationError` from a
 * mismatched VIN/owner surfaces as a tile error.
 */

export type VehiclePhotoTileState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'attached'; readonly url: string }
  | { readonly kind: 'uploading' }
  | { readonly kind: 'error'; readonly error: Error };

export type VehiclePhotosState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: Error }
  | {
      readonly kind: 'ready';
      readonly vehicle: Vehicle;
      readonly tiles: Readonly<Record<VehiclePhotoType, VehiclePhotoTileState>>;
    };

export interface UseVehiclePhotosViewModel {
  readonly state: VehiclePhotosState;
  /** True if any tile has an upload in flight. */
  readonly anyUploading: boolean;
  /** Launch the picker for a tile and (on selection) fire the upload. */
  onPickPhoto: (type: VehiclePhotoType) => void;
  /** Dismiss the per-tile error so the tile re-enables for retry. */
  onClearError: (type: VehiclePhotoType) => void;
  /** Pop back to the previous screen (typically `VehicleDetails`). */
  onDone: () => void;
}

interface PerTileFlags {
  readonly inFlight: Partial<Record<VehiclePhotoType, true>>;
  readonly errors: Partial<Record<VehiclePhotoType, Error>>;
}

const EMPTY_FLAGS: PerTileFlags = { inFlight: {}, errors: {} };

export function useVehiclePhotosViewModel(args: {
  readonly vin: string;
}): UseVehiclePhotosViewModel {
  const navigation = useNavigation<DriverStackNavigation>();

  // Parse the VIN once. A bad VIN string in route.params is a programming
  // error (only screens that we control push this route with a real VIN),
  // but we surface it as an error state rather than throwing so the
  // screen can render a friendly fallback rather than crashing.
  const vinR = Vin.create(args.vin);
  const vin = vinR.ok ? vinR.value : null;

  const vehicleQuery = useVehicleQuery(vin);
  const uploadMutation = useUploadVehiclePhotosMutation();

  const [flags, setFlags] = useState<PerTileFlags>(EMPTY_FLAGS);

  const onPickPhoto = useCallback(
    (type: VehiclePhotoType) => {
      void (async () => {
        if (!vin) return;
        // Re-entry guard: don't launch the picker for a tile that's already
        // mid-upload. The screen disables the press too, but the VM is the
        // authoritative gate for tests that fire callbacks directly.
        if (flags.inFlight[type]) return;

        // Permission check first — `expo-image-picker` is permission-gated
        // on iOS. `requestMediaLibraryPermissionsAsync` is the public API.
        try {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            setFlags((prev) => ({
              inFlight: prev.inFlight,
              errors: {
                ...prev.errors,
                [type]: new Error('Photos permission denied'),
              },
            }));
            return;
          }
        } catch (e) {
          logger.warn('permission request failed', e);
          setFlags((prev) => ({
            inFlight: prev.inFlight,
            errors: {
              ...prev.errors,
              [type]:
                e instanceof Error ? e : new Error('Permission request failed'),
            },
          }));
          return;
        }

        let result: ImagePicker.ImagePickerResult;
        try {
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: 'images',
            quality: 0.7,
            allowsEditing: false,
          });
        } catch (e) {
          logger.warn('picker launch failed', e);
          setFlags((prev) => ({
            inFlight: prev.inFlight,
            errors: {
              ...prev.errors,
              [type]: e instanceof Error ? e : new Error('Picker failed'),
            },
          }));
          return;
        }

        if (result.canceled) return; // silent

        const asset = result.assets[0];
        if (!asset) return; // shouldn't happen on success — defensive

        // Mark in-flight, clear any prior error, then fire the upload.
        setFlags((prev) => {
          const nextErrors = { ...prev.errors };
          delete nextErrors[type];
          return {
            inFlight: { ...prev.inFlight, [type]: true },
            errors: nextErrors,
          };
        });

        try {
          await uploadMutation.mutateAsync({
            vin,
            photos: { [type]: asset.uri },
          });
          // Success: clear in-flight; the byVin invalidation will refetch
          // the vehicle and the tile derivation will see the new URL.
          setFlags((prev) => {
            const nextInFlight = { ...prev.inFlight };
            delete nextInFlight[type];
            return { inFlight: nextInFlight, errors: prev.errors };
          });
        } catch (e) {
          logger.warn(`upload failed for ${type}`, e);
          setFlags((prev) => {
            const nextInFlight = { ...prev.inFlight };
            delete nextInFlight[type];
            return {
              inFlight: nextInFlight,
              errors: {
                ...prev.errors,
                [type]: e instanceof Error ? e : new Error('Upload failed'),
              },
            };
          });
        }
      })();
    },
    [vin, flags.inFlight, uploadMutation],
  );

  const onClearError = useCallback((type: VehiclePhotoType) => {
    setFlags((prev) => {
      const nextErrors = { ...prev.errors };
      delete nextErrors[type];
      return { inFlight: prev.inFlight, errors: nextErrors };
    });
  }, []);

  const onDone = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  let state: VehiclePhotosState;
  if (!vin) {
    state = {
      kind: 'error',
      error: new Error(`Invalid VIN: ${args.vin}`),
    };
  } else if (vehicleQuery.isLoading) {
    state = { kind: 'loading' };
  } else if (vehicleQuery.isError) {
    state = { kind: 'error', error: vehicleQuery.error };
  } else if (!vehicleQuery.data) {
    state = { kind: 'loading' };
  } else {
    const vehicle = vehicleQuery.data;
    const tiles = {} as Record<VehiclePhotoType, VehiclePhotoTileState>;
    for (const type of VEHICLE_PHOTO_TYPES) {
      tiles[type] = deriveTile(type, vehicle, flags);
    }
    state = { kind: 'ready', vehicle, tiles };
  }

  const anyUploading = Object.keys(flags.inFlight).length > 0;

  return {
    state,
    anyUploading,
    onPickPhoto,
    onClearError,
    onDone,
  };
}

function deriveTile(
  type: VehiclePhotoType,
  vehicle: Vehicle,
  flags: PerTileFlags,
): VehiclePhotoTileState {
  if (flags.inFlight[type]) return { kind: 'uploading' };
  const error = flags.errors[type];
  if (error) return { kind: 'error', error };
  const url = vehicle.photos[type];
  if (url !== null) return { kind: 'attached', url };
  return { kind: 'idle' };
}
