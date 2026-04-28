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

  /**
   * Great-circle distance to another point in METERS, computed via the
   * Haversine formula on a spherical-Earth model with mean radius 6_371_000 m.
   *
   * Accuracy: ~0.5% — sufficient for "is this user inside the service area?"
   * checks where the radius is hundreds of kilometres. Not suitable for
   * sub-metre navigation. For trip routing, defer to the Google Routes API
   * which uses geodesic math against a WGS84 ellipsoid.
   *
   * Symmetric: a.distanceTo(b) === b.distanceTo(a).
   */
  distanceTo(other: Coordinates): number {
    const EARTH_RADIUS_METERS = 6_371_000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const φ1 = toRad(this.latitude);
    const φ2 = toRad(other.latitude);
    const Δφ = toRad(other.latitude - this.latitude);
    const Δλ = toRad(other.longitude - this.longitude);
    const a =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
  }

  toString(): string {
    return `${this.latitude.toFixed(6)},${this.longitude.toFixed(6)}`;
  }
}
