import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Stripe Customer ID. Always begins with `cus_` followed by an opaque
 * alphanumeric body. Used to address a rider's Stripe customer record from
 * the YeRide Stripe microservice (`yeride-stripe-server`).
 *
 * Branded so a `StripeCustomerId` cannot be passed where a `StripeAccountId`
 * (Connect account) is expected — the two are distinct objects on Stripe's
 * side and routing one to an endpoint that expects the other is a class of
 * bug we want the type system to prevent.
 *
 * Validity rules:
 *   1. Must begin with the literal prefix `cus_`.
 *   2. Body (after the prefix) must be 1..255 characters of `[A-Za-z0-9]`.
 *      Stripe documents IDs as up to 255 chars total; we cap on the body so
 *      the prefix doesn't eat into the budget.
 */
export type StripeCustomerId = Brand<string, 'StripeCustomerId'>;

const STRIPE_CUSTOMER_ID_PREFIX = 'cus_';
const STRIPE_CUSTOMER_ID_REGEX = /^cus_[A-Za-z0-9]{1,255}$/;

export const StripeCustomerId = {
  create(value: string): Result<StripeCustomerId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'stripe_customer_id_not_a_string',
          message: 'StripeCustomerId must be a string',
          field: 'stripeCustomerId',
        }),
      );
    }
    if (!value.startsWith(STRIPE_CUSTOMER_ID_PREFIX)) {
      return Result.err(
        new ValidationError({
          code: 'stripe_customer_id_invalid_prefix',
          message: `StripeCustomerId must begin with "${STRIPE_CUSTOMER_ID_PREFIX}"`,
          field: 'stripeCustomerId',
        }),
      );
    }
    if (!STRIPE_CUSTOMER_ID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'stripe_customer_id_invalid_format',
          message:
            'StripeCustomerId body must be 1..255 alphanumeric characters',
          field: 'stripeCustomerId',
        }),
      );
    }
    return Result.ok(brand<string, 'StripeCustomerId'>(value));
  },
};
