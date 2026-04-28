import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Driver-side: subscribe to nearby rides waiting for a driver. The
 * adapter applies the Haversine distance cutoff (default 50 mi, matches
 * legacy) and the service-id filter; this use case just hands the
 * subscription to the presentation layer.
 *
 * `driverLocation` is supplied by the caller (live location pipeline lands
 * in Phase 2 turn 3c). Re-subscribe when the driver moves significantly to
 * pick up rides that were previously too far away.
 */
export class ListAvailableRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    driverId: UserId;
    services: readonly RideServiceId[];
    driverLocation: Coordinates;
    radiusMeters?: number;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    return this.repo.subscribeAvailableRides(args);
  }
}
