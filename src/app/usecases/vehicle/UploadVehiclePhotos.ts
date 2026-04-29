import type { UserId } from '@domain/entities/UserId';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { VehiclePhotoType } from '@domain/entities/VehiclePhotoType';
import { VEHICLE_PHOTO_TYPES } from '@domain/entities/VehiclePhotoType';
import type { Vin } from '@domain/entities/Vin';
import {
  AuthorizationError,
  type NetworkError,
  type NotFoundError,
  ValidationError,
} from '@domain/errors';
import type {
  AuthRepository,
  UserRepository,
  VehicleRepository,
  VehicleStorageRepository,
} from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Upload one or more vehicle photos and persist their URLs onto the
 * Vehicle. Accepts a partial map of `{ front?, back?, left?, right?,
 * interior? }` from the platform image picker.
 *
 * Authorization (defense in depth — Q1 confirmed at Turn 2 kickoff):
 *
 *   1. `auth.currentUserId()` must resolve.
 *   2. `users.getById(uid).vehicleIds[]` must include the target VIN —
 *      explicit ownership check before touching Storage. This is on top
 *      of Firestore Security Rules; we want the validation error to
 *      surface BEFORE we burn Storage upload bandwidth.
 *
 * Strategy:
 *
 *   - Per-photo: `vehiclePhotos.uploadPhoto(...)` (Storage write) →
 *     `vehicles.getByVin` → `vehicle.attachPhoto({ type, url, at })` →
 *     `vehicles.update(next)`. Sequential per-photo so the photos map on
 *     the doc accumulates correctly. (A single concurrent
 *     read-modify-write across all five photos would race lost-update
 *     style on the photos map.) Per-photo cost: 1 Storage upload + 1
 *     Firestore read + 1 Firestore write.
 *
 *   - First failure aborts the rest. Photos already uploaded are NOT
 *     rolled back — the partial state is durable, the driver can retry
 *     just the failed slot, and Storage paths are timestamp-suffixed
 *     so retries don't collide.
 *
 *   - Returns the final updated `Vehicle` (with all successful URLs
 *     attached). On error, returns the error from the failing step.
 */
export class UploadVehiclePhotos {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly vehicles: VehicleRepository,
    private readonly vehiclePhotos: VehicleStorageRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    vin: Vin;
    photos: Partial<Record<VehiclePhotoType, string>>;
  }): Promise<
    Result<
      Vehicle,
      AuthorizationError | NotFoundError | NetworkError | ValidationError
    >
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }

    // Ownership pre-check (defense in depth).
    const ownershipR = await this.assertOwnership(uid, args.vin);
    if (!ownershipR.ok) return ownershipR;

    // Filter to entries with a non-empty URI, in the canonical order so
    // tests can assert on call ordering deterministically.
    const entries: Array<{ type: VehiclePhotoType; uri: string }> = [];
    for (const type of VEHICLE_PHOTO_TYPES) {
      const uri = args.photos[type];
      if (typeof uri === 'string' && uri.trim().length > 0) {
        entries.push({ type, uri });
      }
    }

    if (entries.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_photos_empty',
          message: 'At least one photo is required',
          field: 'photos',
        }),
      );
    }

    let lastVehicle: Vehicle | null = null;
    for (const { type, uri } of entries) {
      const uploadR = await this.vehiclePhotos.uploadPhoto({
        vin: args.vin,
        type,
        localUri: uri,
      });
      if (!uploadR.ok) return uploadR;

      const vehicleR = await this.vehicles.getByVin(args.vin);
      if (!vehicleR.ok) return vehicleR;

      const attachedR = vehicleR.value.attachPhoto({
        type,
        url: uploadR.value,
        at: this.clock(),
      });
      if (!attachedR.ok) return attachedR;

      const updateR = await this.vehicles.update(attachedR.value);
      if (!updateR.ok) return updateR;
      lastVehicle = updateR.value;
    }

    // Unreachable — `entries.length === 0` is rejected above. The cast is
    // an assertion to TypeScript that we've definitely written at least
    // one photo and `lastVehicle` is non-null.
    if (lastVehicle === null) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_photos_no_progress',
          message: 'No photos were uploaded',
          field: 'photos',
        }),
      );
    }
    return Result.ok(lastVehicle);
  }

  private async assertOwnership(
    uid: UserId,
    vin: Vin,
  ): Promise<Result<true, AuthorizationError | NotFoundError>> {
    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;
    const user = userR.value;
    if (user.role !== 'driver') {
      return Result.err(
        new AuthorizationError({
          code: 'vehicle_photos_role_not_driver',
          message: 'Only drivers can upload vehicle photos',
        }),
      );
    }
    if (!user.vehicleIds.includes(String(vin))) {
      return Result.err(
        new AuthorizationError({
          code: 'vehicle_photos_not_owned_by_driver',
          message: `Driver ${String(uid)} does not own vehicle ${String(vin)}`,
        }),
      );
    }
    return Result.ok(true);
  }
}
