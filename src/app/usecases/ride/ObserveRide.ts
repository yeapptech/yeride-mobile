import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to a single ride. Subscription-shaped — same pattern
 * as `ObserveAuthState` (see comment there). Emits `null` if the trip doc
 * is removed (rare; admin tooling only).
 */
export class ObserveRide {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    rideId: RideId;
    callback: (ride: Ride | null) => void;
  }): () => void {
    return this.repo.observeById(args.rideId, args.callback);
  }
}
