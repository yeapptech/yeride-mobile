import type { Money } from '@domain/entities/Money';
import type { RideId } from '@domain/entities/RideId';
import {
  AuthorizationError,
  type NetworkError,
  type NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { AuthRepository, RideRepository } from '@domain/repositories';
import type { PaymentCallableService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Tip the driver after trip completion. Routes through the `tipDriver`
 * Cloud Function callable, which orchestrates the Stripe direct-charge
 * to the driver's Connect account, the trip-event write, and the push
 * notification.
 *
 * The Cloud Function is server-idempotent on `(tripId, customerId)` via
 * the trip doc's `payment.tipStatus === 'succeeded'` check (see
 * `yeride-functions/handlers/tip-driver.js`), so a client retry after
 * a network blip is safe — the second call returns the original result.
 *
 * Auth + business rules enforced here BEFORE the callable:
 *   - signed-in user
 *   - caller is the trip's passenger
 *   - rewrite's $1 minimum (stricter than the function's $0.50)
 *   - tip amount must be a whole number of dollars (`minorUnits % 100 === 0`)
 *
 * The callable then re-checks the same rules server-side; the local
 * checks are an optimization (fail fast, no network round-trip on
 * obviously-bad input) and a defense-in-depth.
 *
 * Note on units: `tipAmount` is a `Money` (minor units). The Cloud
 * Function's API takes dollars; we convert at the call boundary by
 * dividing by 100. The `% 100 === 0` check above guarantees no
 * fractional dollars sneak through.
 */
const TIP_MINIMUM_MINOR_UNITS = 100; // $1.00

export class ProcessTip {
  constructor(
    private readonly auth: AuthRepository,
    private readonly rides: RideRepository,
    private readonly paymentCallable: PaymentCallableService,
  ) {}

  async execute(args: {
    rideId: RideId;
    tipAmount: Money;
  }): Promise<
    Result<
      void,
      AuthorizationError | NotFoundError | NetworkError | ValidationError
    >
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }

    if (args.tipAmount.currency !== 'USD') {
      return Result.err(
        new ValidationError({
          code: 'tip_currency_unsupported',
          message: 'Only USD tips are supported',
          field: 'tipAmount.currency',
        }),
      );
    }
    if (args.tipAmount.minorUnits < TIP_MINIMUM_MINOR_UNITS) {
      return Result.err(
        new ValidationError({
          code: 'tip_below_minimum',
          message: 'Tip amount must be at least $1.00',
          field: 'tipAmount',
        }),
      );
    }
    if (args.tipAmount.minorUnits % 100 !== 0) {
      // The Cloud Function takes dollars; fractional dollars would round
      // and silently mis-charge.
      return Result.err(
        new ValidationError({
          code: 'tip_non_whole_dollar',
          message: 'Tip amount must be a whole number of dollars',
          field: 'tipAmount',
        }),
      );
    }

    const rideR = await this.rides.getById(args.rideId);
    if (!rideR.ok) return rideR;
    const ride = rideR.value;

    if (String(ride.passenger.id) !== String(uid)) {
      return Result.err(
        new AuthorizationError({
          code: 'tip_not_passenger',
          message: 'Only the trip rider can tip the driver',
        }),
      );
    }
    if (ride.status !== 'completed') {
      return Result.err(
        new ValidationError({
          code: 'tip_trip_not_completed',
          message: 'Can only tip on a completed trip',
          field: 'ride.status',
        }),
      );
    }

    const tipAmountDollars = Math.round(args.tipAmount.minorUnits / 100);
    const callR = await this.paymentCallable.tipDriver({
      tripId: String(args.rideId),
      tipAmountDollars,
    });
    if (!callR.ok) return callR;
    return Result.ok(undefined);
  }
}
