import type { Payout } from '@domain/entities/Payout';
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

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 10;

/**
 * Recent payouts (transfers from the Connect balance to the driver's
 * external bank account). Defaults match legacy `getAccountPayouts` (7
 * days, 10 rows).
 *
 * Auth: caller must be a signed-in driver AND own `args.accountId`.
 */
export class ListDriverPayouts {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    accountId: StripeAccountId;
    days?: number;
    limit?: number;
  }): Promise<
    Result<
      readonly Payout[],
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
          code: 'stripe_payouts_role_not_driver',
          message: 'Only drivers have payouts',
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
    return this.stripeServer.listAccountPayouts({
      accountId: args.accountId,
      days: args.days ?? DEFAULT_DAYS,
      limit: args.limit ?? DEFAULT_LIMIT,
    });
  }
}
