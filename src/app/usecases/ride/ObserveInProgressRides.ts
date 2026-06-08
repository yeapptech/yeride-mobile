import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to the user's in-progress rides for the Home screen's
 * In-progress section. Role-parameterized: riders observe their
 * passenger-scoped LIVE rides, drivers their driver-scoped ones. Mirrors
 * `ObserveScheduledRides`; subscription-shaped (synchronous unsubscribe).
 */
export class ObserveInProgressRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    userId: UserId;
    role: 'rider' | 'driver';
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    if (args.role === 'driver') {
      return this.repo.observeInProgressRidesByDriver({
        driverId: args.userId,
        callback: args.callback,
      });
    }
    return this.repo.observeInProgressRidesByPassenger({
      passengerId: args.userId,
      callback: args.callback,
    });
  }
}
