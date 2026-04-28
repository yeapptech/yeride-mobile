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
 * Driver picks up the rider. Records the pickup-completion odometer and
 * flips status to `'started'`. Direct Firestore write — no Cloud Function
 * involvement.
 *
 * Odometer is in METRES, sourced from the driver's GPS-derived odometer
 * (Phase 2 turn 3c handles the live measurement).
 */
export class StartRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
    odometerMeters: number;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.start({
      odometerMeters: args.odometerMeters,
      at: this.clock(),
    });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
