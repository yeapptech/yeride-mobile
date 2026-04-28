import { CancellationReason } from '@domain/entities/CancellationReason';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type {
  AuthorizationError,
  NetworkError,
  NotFoundError,
} from '@domain/errors';
import { ValidationError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Rider cancels the ride. Routes through the `cancelTrip` Cloud Function
 * (server-side fee math + Stripe refund / charge as needed).
 *
 * Authorization: ENFORCES the rider-allowed cancellation-code set —
 * `'driver_no_show'` is rider-only, `'passenger_no_show'` is rejected.
 * (The entity's `cancel` method is symmetric on `by`; the role gate
 * lives here so use-case naming stays the audit boundary.)
 */
export class CancelRideByRider {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    rideId: RideId;
    reason: CancellationReason;
    odometerMeters?: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    if (!CancellationReason.isRiderCode(args.reason.code)) {
      return Promise.resolve(
        Result.err(
          new ValidationError({
            code: 'cancellation_reason_not_rider_allowed',
            message: `Riders cannot cite cancellation code "${args.reason.code}"`,
            field: 'reason.code',
          }),
        ),
      );
    }
    return this.repo.cancel({
      rideId: args.rideId,
      by: 'rider',
      reason: args.reason,
      ...(args.odometerMeters !== undefined
        ? { odometerMeters: args.odometerMeters }
        : {}),
    });
  }
}
