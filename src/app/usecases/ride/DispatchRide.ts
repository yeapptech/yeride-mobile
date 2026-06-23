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
 * Driver claims an awaiting_driver ride — first-come-first-served. Routes
 * through `transitionWithClaim`, which atomically re-reads the ride and
 * applies `claimForDispatch` only while it's still `awaiting_driver`; a
 * driver who loses the race gets a `ConflictError('ride_already_taken')`.
 *
 * Pickup directions (driver→pickup) are deliberately NOT computed here —
 * the winning driver computes them via `ComputeRoutes` and attaches them
 * afterwards (`AttachPickupDirections`), so the claim stays on the fast
 * path and only the winner spends a Google Routes quota unit.
 */
export class DispatchRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
    driver: DriverSnapshot;
  }): Promise<
    Result<
      Ride,
      ConflictError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    const at = this.clock();
    return this.repo.transitionWithClaim({
      rideId: args.rideId,
      expectedFromStatus: 'awaiting_driver',
      apply: (current) => current.claimForDispatch({ driver: args.driver, at }),
    });
  }
}
