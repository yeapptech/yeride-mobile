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
 * Generate the Stripe-hosted onboarding URL the driver opens in
 * `WebBrowser.openAuthSessionAsync`. URL is single-use and expires
 * server-side per Stripe's policy.
 *
 * Auth: caller must be a signed-in driver AND `args.accountId` must
 * match the driver's stored `stripeAccountId`.
 */
export class CreateConnectOnboardingLink {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
  ) {}

  async execute(args: {
    accountId: StripeAccountId;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<
    Result<
      { url: string; expiresAt: Date },
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
          code: 'stripe_link_role_not_driver',
          message: 'Only drivers can create a Connect onboarding link',
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
    return this.stripeServer.createAccountLink({
      accountId: args.accountId,
      refreshUrl: args.refreshUrl,
      returnUrl: args.returnUrl,
    });
  }
}
