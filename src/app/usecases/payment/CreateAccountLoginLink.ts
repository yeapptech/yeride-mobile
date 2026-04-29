import type { StripeAccountId } from '@domain/entities/StripeAccountId';
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
 * Generate the URL into the driver's Stripe Express dashboard. Surfaces
 * behind a "View Express dashboard" affordance on the Earnings tab
 * (Phase 6 turn 4).
 *
 * Auth: caller must be a signed-in driver AND own `args.accountId`.
 */
export class CreateAccountLoginLink {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { url: string },
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
    if (user.role !== 'driver') {
      return Result.err(
        new AuthorizationError({
          code: 'stripe_login_link_role_not_driver',
          message: 'Only drivers have an Express dashboard',
        }),
      );
    }
    if (
      user.stripeAccountId === null ||
      String(user.stripeAccountId) !== String(args.accountId)
    ) {
      return Result.err(
        new AuthorizationError({
          code: 'stripe_account_mismatch',
          message: 'Caller does not own that Stripe Connect account',
        }),
      );
    }
    return this.stripeServer.createAccountLoginLink({
      accountId: args.accountId,
    });
  }
}
