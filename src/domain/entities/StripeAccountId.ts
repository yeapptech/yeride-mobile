import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Stripe Connect Account ID. Always begins with `acct_` followed by an opaque
 * alphanumeric body. Identifies a driver's connected Stripe account that
 * receives marketplace payouts via the `yeride-stripe-server` Connect
 * endpoints.
 *
 * Branded so a `StripeAccountId` (Connect — driver) is distinct from a
 * `StripeCustomerId` (rider). They flow through different endpoints on the
 * Stripe microservice; mixing them is a class of bug the type system can
 * catch.
 *
 * Validity rules:
 *   1. Must begin with the literal prefix `acct_`.
 *   2. Body (after the prefix) must be 1..255 characters of `[A-Za-z0-9]`.
 */
export type StripeAccountId = Brand<string, 'StripeAccountId'>;

const STRIPE_ACCOUNT_ID_PREFIX = 'acct_';
const STRIPE_ACCOUNT_ID_REGEX = /^acct_[A-Za-z0-9]{1,255}$/;

export const StripeAccountId = {
  create(value: string): Result<StripeAccountId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'stripe_account_id_not_a_string',
          message: 'StripeAccountId must be a string',
          field: 'stripeAccountId',
        }),
      );
    }
    if (!value.startsWith(STRIPE_ACCOUNT_ID_PREFIX)) {
      return Result.err(
        new ValidationError({
          code: 'stripe_account_id_invalid_prefix',
          message: `StripeAccountId must begin with "${STRIPE_ACCOUNT_ID_PREFIX}"`,
          field: 'stripeAccountId',
        }),
      );
    }
    if (!STRIPE_ACCOUNT_ID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'stripe_account_id_invalid_format',
          message:
            'StripeAccountId body must be 1..255 alphanumeric characters',
          field: 'stripeAccountId',
        }),
      );
    }
    return Result.ok(brand<string, 'StripeAccountId'>(value));
  },
};
