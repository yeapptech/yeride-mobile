import type { VehiclePhotoType } from '../entities/VehiclePhotoType';
import type { Vin } from '../entities/Vin';
import type { NetworkError, ValidationError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Storage abstraction for vehicle photos. Kept separate from
 * `VehicleRepository` so the in-memory storage fake can stay trivial
 * (no Firebase Storage imports, no filesystem I/O) and so future
 * profile-photo work can reuse the storage abstraction without dragging
 * vehicle CRUD in.
 *
 * Production adapter (Turn 2) wraps `@react-native-firebase/storage`'s
 * `putFile` + `getDownloadURL` against the legacy
 * `vehicles/{vin}/{type}_{timestamp}.jpg` path layout.
 *
 * The caller is responsible for then writing the returned URL onto the
 * Vehicle via `Vehicle.attachPhoto` + `VehicleRepository.update` — the
 * storage adapter doesn't touch Firestore.
 */
export interface VehicleStorageRepository {
  /**
   * Upload one photo to the canonical Storage path and return its public
   * download URL.
   *
   * `localUri` is whatever the platform image picker returned (e.g.
   * `file://...` on iOS, `content://...` on Android). The adapter knows
   * how to read it.
   *
   * Returns `ValidationError` if `localUri` is empty/malformed,
   * `NetworkError` for transient Storage failures.
   */
  uploadPhoto(args: {
    vin: Vin;
    type: VehiclePhotoType;
    localUri: string;
  }): Promise<Result<string, NetworkError | ValidationError>>;
}
