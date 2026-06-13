import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver accepts a scheduled ride. Reads the current state, runs the
 * entity transition (which enforces the `scheduled` precondition + sets
 * the driver snapshot), and writes back. No pickup directions are attached
 * — that happens at begin time (`BeginScheduledRide`). Mirrors
 * `DispatchRide`'s shape; driver eligibility (active vehicle + Stripe) is
 * gated in the view-model, as it is for immediate dispatch.
 */
export class AcceptScheduledRide {
  constructor(private readonly repo: RideRepository) {}

  async execute(args: {
    rideId: RideId;
    driver: DriverSnapshot;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.acceptSchedule({ driver: args.driver });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
