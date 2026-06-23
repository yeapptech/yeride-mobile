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
 * Driver begins an accepted scheduled ride — flipping it to `dispatched`
 * so it enters the normal live-trip flow. Routes through
 * `transitionWithClaim` (atomic, guarded on `scheduled_driver_accepted`)
 * so a ride the rider cancelled in the meantime fails cleanly with a
 * ConflictError rather than clobbering the cancellation.
 *
 * As with `DispatchRide`, pickup directions are computed + attached
 * afterwards via `AttachPickupDirections`, not here.
 */
export class BeginScheduledRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
  }): Promise<
    Result<
      Ride,
      ConflictError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    const at = this.clock();
    return this.repo.transitionWithClaim({
      rideId: args.rideId,
      expectedFromStatus: 'scheduled_driver_accepted',
      apply: (current) => current.beginScheduledClaim({ at }),
    });
  }
}
