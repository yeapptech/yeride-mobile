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
 * Driver cancels the ride. Same contract as `CancelRideByRider` but
 * enforces the driver-allowed cancellation-code set:
 * `'passenger_no_show'` is driver-only, `'driver_no_show'` is rejected.
 */
export class CancelRideByDriver {
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
    if (!CancellationReason.isDriverCode(args.reason.code)) {
      return Promise.resolve(
        Result.err(
          new ValidationError({
            code: 'cancellation_reason_not_driver_allowed',
            message: `Drivers cannot cite cancellation code "${args.reason.code}"`,
            field: 'reason.code',
          }),
        ),
      );
    }
    return this.repo.cancel({
      rideId: args.rideId,
      by: 'driver',
      reason: args.reason,
      ...(args.odometerMeters !== undefined
        ? { odometerMeters: args.odometerMeters }
        : {}),
    });
  }
}
