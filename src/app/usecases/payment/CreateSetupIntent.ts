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
 * Create a Stripe SetupIntent the rider's device feeds into
 * `confirmSetupIntent({clientSecret})` to attach a card. The client
 * secret returned here is single-use and short-lived.
 *
 * Auth: caller must be a signed-in rider AND `args.customerId` must
 * match the rider's stored `stripeCustomerId`. The server enforces
 * this too, but the client-side check fails fast and surfaces a
 * `'stripe_customer_mismatch'` code rather than the server's generic
 * 4xx body.
 */
export class CreateSetupIntent {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    customerId: StripeCustomerId;
  }): Promise<
    Result<
      { clientSecret: string },
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
          code: 'stripe_setup_intent_role_not_rider',
          message: 'Only riders can create a SetupIntent',
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
    return this.stripeServer.createSetupIntent({ customerId: args.customerId });
  }
}
