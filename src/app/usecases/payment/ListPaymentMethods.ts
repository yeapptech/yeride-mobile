import type { PaymentMethod } from '@domain/entities/PaymentMethod';
import type { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import {
  AuthorizationError,
  type NetworkError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import type { StripeServerService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * List the rider's saved payment methods. Auth-gated on the caller
 * owning `args.customerId` so a malicious view-model can't list someone
 * else's wallet.
 */
export class ListPaymentMethods {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    customerId: StripeCustomerId;
  }): Promise<
    Result<
      readonly PaymentMethod[],
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
    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;
    const user = userR.value;
    if (user.role !== 'rider') {
      return Result.err(
        new AuthorizationError({
          code: 'stripe_list_methods_role_not_rider',
          message: 'Only riders can list payment methods',
        }),
      );
    }
    if (
      user.stripeCustomerId === null ||
      String(user.stripeCustomerId) !== String(args.customerId)
    ) {
      return Result.err(
        new AuthorizationError({
          code: 'stripe_customer_mismatch',
          message: 'Caller does not own that Stripe customer',
        }),
      );
    }
    return this.stripeServer.listPaymentMethods({
      customerId: args.customerId,
    });
  }
}
