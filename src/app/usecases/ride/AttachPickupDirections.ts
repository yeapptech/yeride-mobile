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
 * Attach the freshly-computed driver→pickup directions to a ride that has
 * already been claimed (`dispatched`). The winning driver computes the
 * `Route` via `ComputeRoutes` after the claim and calls this to fill in the
 * pickup polyline + ETA that the rider's DispatchedView and the driver's
 * EnRouteToPickupView render.
 *
 * Tolerant by design: if the rider cancelled in the window between claim
 * and attach, `attachPickupDirections` returns a `ValidationError`
 * (illegal transition) which the caller (`useAttachPickupDirections`)
 * ignores — there's nothing to attach to a cancelled ride.
 */
export class AttachPickupDirections {
  constructor(private readonly repo: RideRepository) {}

  async execute(args: {
    rideId: RideId;
    directions: Route;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.attachPickupDirections(args.directions);
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
