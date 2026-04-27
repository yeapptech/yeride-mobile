import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * A lat/lng pair on Earth.
 *
 *   latitude   ∈ [-90,  90]
 *   longitude  ∈ [-180, 180]
 *
 * Both must be finite numbers (NaN/Infinity rejected).
 */
export class Coordinates {
  private constructor(
    public readonly latitude: number,
    public readonly longitude: number,
  ) {}

  static create(
    latitude: number,
    longitude: number,
  ): Result<Coordinates, ValidationError> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return Result.err(
        new ValidationError({
          code: 'coordinates_not_finite',
          message: 'latitude and longitude must be finite numbers',
        }),
      );
    }
    if (latitude < -90 || latitude > 90) {
      return Result.err(
        new ValidationError({
          code: 'coordinates_lat_out_of_range',
          message: `latitude ${String(latitude)} is out of range [-90, 90]`,
          field: 'latitude',
        }),
      );
    }
    if (longitude < -180 || longitude > 180) {
      return Result.err(
        new ValidationError({
          code: 'coordinates_lng_out_of_range',
          message: `longitude ${String(longitude)} is out of range [-180, 180]`,
          field: 'longitude',
        }),
      );
    }
    return Result.ok(new Coordinates(latitude, longitude));
  }

  equals(other: Coordinates): boolean {
    return (
      this.latitude === other.latitude && this.longitude === other.longitude
    );
  }

  toString(): string {
    return `${this.latitude.toFixed(6)},${this.longitude.toFixed(6)}`;
  }
}
