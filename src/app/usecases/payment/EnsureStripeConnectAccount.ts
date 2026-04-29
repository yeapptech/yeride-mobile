import type { StripeAccountId } from '@domain/entities/StripeAccountId';
import { setStripeAccountId } from '@domain/entities/User';
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
 * Ensure the signed-in driver has a Stripe Connect account.
 *
 * Idempotent: returns the existing `stripeAccountId` from the user doc
 * when one is present. Otherwise calls
 * `StripeServerService.createConnectAccount`, persists the returned id,
 * and returns it. The user-doc check is the rewrite's idempotency
 * mechanism — the server doesn't de-dupe by email for accounts (legacy
 * `accounts-create` always creates).
 *
 * Auth: caller must be a signed-in driver.
 */
export class EnsureStripeConnectAccount {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args?: {
    country?: string;
  }): Promise<
    Result<
      StripeAccountId,
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
          code: 'stripe_connect_role_not_driver',
          message: 'Only drivers can have a Stripe Connect account',
        }),
      );
    }
    if (user.stripeAccountId !== null) {
      return Result.ok(user.stripeAccountId);
    }

    const createArgs: {
      userId: typeof uid;
      email: typeof user.email;
      country?: string;
    } = {
      userId: uid,
      email: user.email,
    };
    if (args?.country !== undefined) createArgs.country = args.country;
    const createdR = await this.stripeServer.createConnectAccount(createArgs);
    if (!createdR.ok) return createdR;

    const updated = setStripeAccountId(user, createdR.value, this.clock());
    const persistR = await this.users.update(updated);
    if (!persistR.ok) return persistR;

    return Result.ok(createdR.value);
  }
}
