import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
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
 * Driver accepts an awaiting_driver ride. Reads the current state, runs
 * the entity transition (which enforces the `awaiting_driver` precondition
 * + sets pickup directions + records start time), and writes back.
 *
 * The driver app is responsible for computing pickup directions
 * (driver→pickup) via `ComputeRoutes` and passing the resulting `Route`
 * here; the use case attaches it to the entity.
 */
export class DispatchRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
    driver: DriverSnapshot;
    pickupDirections: Route;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.dispatch({
      driver: args.driver,
      pickupDirections: args.pickupDirections,
      at: this.clock(),
    });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
