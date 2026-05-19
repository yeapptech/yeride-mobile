import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to the rider's scheduled rides — pending dispatch
 * (`'scheduled'`) plus the post-acceptance pre-pickup window
 * (`'scheduled_driver_accepted'`). Used by the rider's Activity tab to
 * render the Scheduled section above the recent-rides list.
 *
 * Subscription-shaped (returns synchronous unsubscribe) because the
 * rider's scheduled set DOES mutate while they watch it: a driver
 * accepts, the pickup window arrives and the trip is dispatched, the
 * rider cancels. Callers wire this through
 * `useUseCaseSubscription` and surface the resulting `Ride[]` to UI.
 *
 * Ordering is client-side: the repository contract intentionally
 * doesn't impose a server-side `orderBy` (avoids a composite-index
 * deploy at cutover, per Phase 10 cutover-plan §3.4). The Activity
 * VM sorts by `schedulePickupAt asc` so "next-soonest" sits on top.
 */
export class ObserveScheduledRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    return this.repo.observeScheduledRidesByPassenger({
      passengerId: args.passengerId,
      callback: args.callback,
    });
  }
}
