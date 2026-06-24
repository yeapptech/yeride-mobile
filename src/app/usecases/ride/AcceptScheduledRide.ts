import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver accepts a scheduled ride — first-come-first-served. Routes through
 * `transitionWithClaim` (atomic, guarded on `scheduled`) so the first
 * driver to accept wins and any later driver gets a
 * `ConflictError('ride_already_taken')`. No pickup directions are attached
 * — that happens at begin time (`BeginScheduledRide` → then
 * `AttachPickupDirections`). Driver eligibility (active vehicle + Stripe)
 * is gated in the view-model, as it is for immediate dispatch.
 */
export class AcceptScheduledRide {
  constructor(private readonly repo: RideRepository) {}

  async execute(args: {
    rideId: RideId;
    driver: DriverSnapshot;
  }): Promise<
    Result<
      Ride,
      ConflictError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    return this.repo.transitionWithClaim({
      rideId: args.rideId,
      expectedFromStatus: 'scheduled',
      apply: (current) => current.acceptSchedule({ driver: args.driver }),
    });
  }
}
