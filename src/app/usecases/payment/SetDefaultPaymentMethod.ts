import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { setDefaultPaymentMethodId } from '@domain/entities/User';
import { AuthorizationError, type NotFoundError } from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Set or clear the signed-in rider's default payment method. Pure
 * Firestore write — no Stripe call. The default is read by `CreateRide`
 * (well, by the rider view-model that builds `PassengerSnapshot`) and
 * baked into the trip doc's `passenger.defaultPaymentMethod` field for
 * the server-side `completeTrip` charge pipeline.
 *
 * `paymentMethodId: null` clears the default — used by
 * `DetachPaymentMethod` when the detached card was the default.
 */
export class SetDefaultPaymentMethod {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    paymentMethodId: PaymentMethodId | null;
  }): Promise<Result<true, AuthorizationError | NotFoundError>> {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;
    const user = userR.value;
    if (user.role !== 'rider') {
      return Result.err(
        new AuthorizationError({
          code: 'stripe_set_default_role_not_rider',
          message: 'Only riders have a default payment method',
        }),
      );
    }
    const updated = setDefaultPaymentMethodId(
      user,
      args.paymentMethodId,
      this.clock(),
    );
    const persistR = await this.users.update(updated);
    if (!persistR.ok) return persistR;
    return Result.ok(true);
  }
}
