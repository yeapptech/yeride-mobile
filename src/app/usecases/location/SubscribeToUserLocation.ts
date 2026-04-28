import type { UserId } from '@domain/entities/UserId';
import type { UserLocation } from '@domain/entities/UserLocation';
import type { LocationRepository } from '@domain/repositories';

/**
 * Subscribe to live updates of a user's location. Used by the rider's
 * UI to track the driver after dispatch — drives the live ETA + the
 * map pin animation.
 *
 * Subscription-shaped (matches `ObserveAuthState` / `ObserveRide`
 * conventions). Returns a synchronous unsubscribe function.
 *
 * Note: the legacy `subscribeToUserLocation` returned a Promise, which
 * was a known footgun (async cleanup doesn't fit React's effect contract).
 * The rewrite fixes that — see `LocationRepository` interface comment.
 */
export class SubscribeToUserLocation {
  constructor(private readonly repo: LocationRepository) {}

  execute(args: {
    userId: UserId;
    callback: (location: UserLocation | null) => void;
  }): () => void {
    return this.repo.subscribeToLocation(args);
  }
}
