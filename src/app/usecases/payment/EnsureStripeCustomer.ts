import type { PersonName } from '@domain/entities/PersonName';
import type { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { setStripeCustomerId } from '@domain/entities/User';
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
 * Ensure the signed-in rider has a Stripe Customer record.
 *
 * Idempotent: returns the rider's existing `stripeCustomerId` when one is
 * already on the user doc. Otherwise calls `StripeServerService.createCustomer`
 * (which itself de-dupes by email server-side via the legacy
 * `customers-create` endpoint), persists the returned id on the user doc,
 * and returns it.
 *
 * Auth: caller must be a signed-in rider. Drivers can't call this — only
 * riders pay; riders' Stripe accounts are isolated from driver Connect
 * accounts.
 *
 * Failure modes:
 *   - `AuthorizationError` — no signed-in user, or user is a driver.
 *   - `NotFoundError`      — user doc is missing.
 *   - `NetworkError` / `ValidationError` — bubbled from the Stripe server.
 */
export class EnsureStripeCustomer {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<
    Result<
      StripeCustomerId,
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
          code: 'stripe_customer_role_not_rider',
          message: 'Only riders can have a Stripe customer',
        }),
      );
    }

    if (user.stripeCustomerId !== null) {
      return Result.ok(user.stripeCustomerId);
    }

    const createdR = await this.stripeServer.createCustomer({
      userId: uid,
      name: nameFor(user.name),
      email: user.email,
    });
    if (!createdR.ok) return createdR;

    const updatedRider = setStripeCustomerId(
      user,
      createdR.value,
      this.clock(),
    );
    const persistedR = await this.users.update(updatedRider);
    if (!persistedR.ok) return persistedR;

    return Result.ok(createdR.value);
  }
}

function nameFor(personName: PersonName): string {
  return personName.full;
}
