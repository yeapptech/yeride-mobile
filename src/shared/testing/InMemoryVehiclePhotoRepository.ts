import type { VehiclePhotoType } from '@domain/entities/VehiclePhotoType';
import type { Vin } from '@domain/entities/Vin';
import { ValidationError, type NetworkError } from '@domain/errors';
import type { VehicleStorageRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `VehicleStorageRepository`. Returns deterministic fake URLs
 * shaped like `memory://vehicles/{vin}/{type}_{seq}.jpg`.
 *
 * `seq` is a per-instance monotonically-increasing counter, NOT a real
 * timestamp — tests need URL stability across a single run, and a clock-
 * based timestamp would race when two uploads land in the same ms.
 *
 * Test seams:
 *   - `getUploads()` — array of every upload made, in order, for
 *     order-of-operations assertions.
 *   - `mockNextUploadError(error)` — make the next call fail.
 */
export class InMemoryVehiclePhotoRepository implements VehicleStorageRepository {
  private uploads: Array<{
    vin: string;
    type: VehiclePhotoType;
    localUri: string;
    url: string;
  }> = [];

  private seq = 0;

  private nextErrorResult: NetworkError | ValidationError | null = null;

  async uploadPhoto(args: {
    vin: Vin;
    type: VehiclePhotoType;
    localUri: string;
  }): Promise<Result<string, NetworkError | ValidationError>> {
    if (this.nextErrorResult) {
      const e = this.nextErrorResult;
      this.nextErrorResult = null;
      return Result.err(e);
    }
    if (
      typeof args.localUri !== 'string' ||
      args.localUri.trim().length === 0
    ) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_photo_invalid_local_uri',
          message: 'localUri is required',
          field: 'localUri',
        }),
      );
    }
    this.seq += 1;
    const url = `memory://vehicles/${String(args.vin)}/${args.type}_${String(this.seq)}.jpg`;
    this.uploads.push({
      vin: String(args.vin),
      type: args.type,
      localUri: args.localUri,
      url,
    });
    return Result.ok(url);
  }

  /* ─────────── Test-only helpers ─────────── */

  getUploads(): ReadonlyArray<{
    vin: string;
    type: VehiclePhotoType;
    localUri: string;
    url: string;
  }> {
    return this.uploads;
  }

  mockNextUploadError(error: NetworkError | ValidationError): void {
    this.nextErrorResult = error;
  }

  reset(): void {
    this.uploads = [];
    this.seq = 0;
    this.nextErrorResult = null;
  }
}
