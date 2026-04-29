import type { BalanceTransaction } from '@domain/entities/BalanceTransaction';
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
const DEFAULT_LIMIT = 25;

/**
 * Recent balance-transaction ledger rows (charges, transfers, fees,
 * payouts) on the driver's Connect account. Defaults match legacy
 * `getAccountBalanceTransactions` (7 days, 25 rows).
 *
 * Auth: caller must be a signed-in driver AND own `args.accountId`.
 */
export class ListBalanceTransactions {
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
      readonly BalanceTransaction[],
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
          code: 'stripe_txns_role_not_driver',
          message: 'Only drivers have balance transactions',
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
    return this.stripeServer.listBalanceTransactions({
      accountId: args.accountId,
      days: args.days ?? DEFAULT_DAYS,
      limit: args.limit ?? DEFAULT_LIMIT,
    });
  }
}
