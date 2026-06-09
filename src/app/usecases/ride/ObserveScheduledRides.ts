import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to a user's scheduled rides for the Home/Activity
 * Scheduled section. Role-parameterized (mirrors `ObserveInProgressRides`):
 * riders observe `'scheduled'` + `'scheduled_driver_accepted'`; drivers
 * observe their accepted `'scheduled_driver_accepted'` rides.
 * Subscription-shaped (synchronous unsubscribe). Callers sort by
 * `schedulePickupAt asc` client-side.
 */
export class ObserveScheduledRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    userId: UserId;
    role: 'rider' | 'driver';
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    if (args.role === 'driver') {
      return this.repo.observeScheduledRidesByDriver({
        driverId: args.userId,
        callback: args.callback,
      });
    }
    return this.repo.observeScheduledRidesByPassenger({
      passengerId: args.userId,
      callback: args.callback,
    });
  }
}
