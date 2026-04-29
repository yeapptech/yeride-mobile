import type { StripeAccountId } from '@domain/entities/StripeAccountId';
import { setStripeAccountFlags } from '@domain/entities/User';
import {
  AuthorizationError,
  NetworkError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import type { StripeServerService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Re-fetch the driver's Connect account flags from Stripe and persist
 * them on the user doc. Called after `WebBrowser.openAuthSessionAsync`
 * returns from the onboarding flow.
 *
 * Returns the resolved flags so the caller can render without an extra
 * user-doc read.
 *
 * Order matters: server read FIRST, then doc write. If the server read
 * succeeds but the user-doc update fails, surface a `NetworkError`
 * (rather than silently succeeding) so the caller knows to retry.
 */
export class RefreshConnectAccountStatus {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    accountId: StripeAccountId;
  }): Promise<
    Result<
      { chargesEnabled: boolean; payoutsEnabled: boolean },
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
          code: 'stripe_refresh_role_not_driver',
          message: 'Only drivers have a Connect account',
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

    const flagsR = await this.stripeServer.retrieveAccount({
      accountId: args.accountId,
    });
    if (!flagsR.ok) return flagsR;

    const updated = setStripeAccountFlags(user, flagsR.value, this.clock());
    const persistR = await this.users.update(updated);
    if (!persistR.ok) {
      return Result.err(
        new NetworkError({
          code: 'stripe_refresh_persist_failed',
          message:
            'Stripe Connect status refreshed but failed to persist to user doc',
          cause: persistR.error,
        }),
      );
    }

    return Result.ok(flagsR.value);
  }
}
