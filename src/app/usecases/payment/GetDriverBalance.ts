import type { Money } from '@domain/entities/Money';
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
 * Fetch the available + pending balance on the driver's Connect
 * account. Powers the headline number on the Earnings tab.
 *
 * Auth: caller must be a signed-in driver AND own `args.accountId`.
 */
export class GetDriverBalance {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { available: Money; pending: Money },
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
          code: 'stripe_balance_role_not_driver',
          message: 'Only drivers have a Connect balance',
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
    return this.stripeServer.getAccountBalance({ accountId: args.accountId });
  }
}
