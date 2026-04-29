import {
  getDownloadURL,
  getStorage,
  putFile,
  ref as storageRef,
} from '@react-native-firebase/storage';

import type { VehiclePhotoType } from '@domain/entities/VehiclePhotoType';
import type { Vin } from '@domain/entities/Vin';
import { NetworkError, ValidationError } from '@domain/errors';
import type { VehicleStorageRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('FirebaseStorageVehiclePhoto');

/**
 * Concrete `VehicleStorageRepository` backed by
 * `@react-native-firebase/storage` (modular API).
 *
 * Path layout matches legacy `uploadVehiclePhoto` exactly:
 *
 *   `vehicles/{VIN}/{type}_{Date.now()}.jpg`
 *
 * Why timestamp-suffixed and not deterministic by-type: keeps the URL
 * stable for in-flight rides if a photo is replaced (the old URL on the
 * Vehicle doc keeps resolving), and avoids a Firestore-storage race when
 * the user re-uploads the same slot quickly.
 *
 * The adapter does NOT touch Firestore — the `UploadVehiclePhotos` use
 * case is responsible for calling `Vehicle.attachPhoto` +
 * `VehicleRepository.update` after the upload succeeds.
 *
 * Errors:
 *   - `localUri` empty / non-string → `ValidationError`.
 *   - Storage `putFile` / `getDownloadURL` failure → `NetworkError`,
 *     with the SDK error preserved on `cause`.
 */
export class FirebaseStorageVehiclePhotoRepository implements VehicleStorageRepository {
  private readonly storage = getStorage();

  async uploadPhoto(args: {
    vin: Vin;
    type: VehiclePhotoType;
    localUri: string;
  }): Promise<Result<string, NetworkError | ValidationError>> {
    if (
      typeof args.localUri !== 'string' ||
      args.localUri.trim().length === 0
    ) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_photo_invalid_local_uri',
          message: 'localUri must be a non-empty string',
          field: 'localUri',
        }),
      );
    }
    const path = `vehicles/${String(args.vin)}/${args.type}_${String(Date.now())}.jpg`;
    const ref = storageRef(this.storage, path);
    try {
      await putFile(ref, args.localUri);
      const url = await getDownloadURL(ref);
      return Result.ok(url);
    } catch (e) {
      logger.error('uploadPhoto failed', e);
      return Result.err(
        new NetworkError({
          code: 'vehicle_photo_upload_failed',
          message: 'Could not upload vehicle photo to Storage',
          cause: e,
        }),
      );
    }
  }
}
