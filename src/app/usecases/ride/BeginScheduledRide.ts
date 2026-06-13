import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { Route } from '@domain/entities/Route';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver begins an accepted scheduled ride. Reads the current state, runs
 * the entity transition (which enforces the `scheduled_driver_accepted`
 * precondition, attaches the driver→pickup directions, and records the
 * start time), and writes back — flipping the ride to `dispatched` so it
 * enters the normal live-trip flow. Mirrors `DispatchRide`'s shape.
 *
 * The driver app computes pickup directions (driver→pickup) via
 * `ComputeRoutes` and passes the resulting `Route` here.
 */
export class BeginScheduledRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
    pickupDirections: Route;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.beginScheduledRide({
      pickupDirections: args.pickupDirections,
      at: this.clock(),
    });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
