import type { RideId } from '@domain/entities/RideId';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to a ride's audit-event log
 * (`trips/{tripId}/events/{eventId}`). Subscription-shaped — same pattern
 * as `ObserveAuthState` and `ObserveRide`. Events emit sorted by
 * `createdAt` ascending so the UI renders the timeline in chronological
 * order.
 *
 *   const unsubscribe = observeTripEvents.execute({
 *     rideId,
 *     callback: (events) => { ... },
 *   });
 *   // later:
 *   unsubscribe();
 *
 * Used by `RideMonitor` status views (DispatchedView, StartedView, etc.)
 * to render the human-readable timeline. Read-only on the client — events
 * are written by Cloud Functions on every state transition.
 */
export class ObserveTripEvents {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    rideId: RideId;
    callback: (events: readonly TripEvent[]) => void;
  }): () => void {
    return this.repo.subscribeEvents(args);
  }
}
