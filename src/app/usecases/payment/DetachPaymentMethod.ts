import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { setDefaultPaymentMethodId } from '@domain/entities/User';
import {
  AuthorizationError,
  type NetworkError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import type { StripeServerService } from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('PAYMENT');

/**
 * Detach a saved card from the rider's Stripe customer record.
 *
 * If the detached card is the rider's default, we clear the user-doc
 * default FIRST (before the server detach). Order matters: if we
 * detach Stripe-side first and the user-doc clear fails, the rider's
 * `defaultPaymentMethodId` would point at a card that no longer exists
 * — `CreateRide` would bake a stale id into the next trip's
 * `defaultPaymentMethod` and the trip would fail to charge.
 *
 * If the detach itself fails after the local default has been cleared,
 * we attempt to restore the default — best-effort; if that also fails,
 * the user is left in the "no default selected" state, which is
 * recoverable (UI prompts them to pick a default again) and safer than
 * pointing at a half-detached card.
 */
export class DetachPaymentMethod {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly stripeServer: StripeServerService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    paymentMethodId: PaymentMethodId;
  }): Promise<
    Result<
      true,
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
          code: 'stripe_detach_role_not_rider',
          message: 'Only riders can detach a payment method',
        }),
      );
    }

    const wasDefault =
      user.defaultPaymentMethodId !== null &&
      String(user.defaultPaymentMethodId) === String(args.paymentMethodId);
    const previousDefault = user.defaultPaymentMethodId;

    if (wasDefault) {
      const cleared = setDefaultPaymentMethodId(user, null, this.clock());
      const clearR = await this.users.update(cleared);
      if (!clearR.ok) return clearR;
    }

    const detachR = await this.stripeServer.detachPaymentMethod({
      paymentMethodId: args.paymentMethodId,
    });
    if (!detachR.ok) {
      // Best-effort restore of the default if we cleared it.
      if (wasDefault && previousDefault !== null) {
        const restored = setDefaultPaymentMethodId(
          user,
          previousDefault,
          this.clock(),
        );
        const restoreR = await this.users.update(restored);
        if (!restoreR.ok) {
          logger.warn(
            'detach failed AND default-restore failed; rider left with no default',
            { uid: String(uid) },
          );
        }
      }
      return detachR;
    }
    return Result.ok(true);
  }
}
