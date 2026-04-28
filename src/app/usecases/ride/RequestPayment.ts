import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type {
  AuthorizationError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver-side trip completion. Routes through the `completeTrip` Cloud
 * Function (server-side fare math + auth checks + Stripe charge kickoff).
 * The function flips status to `'payment_requested'`; the Stripe webhook
 * later flips it to `'completed'` via a separate path.
 */
export class RequestPayment {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    rideId: RideId;
    odometerMeters: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    return this.repo.requestPayment(args);
  }
}
