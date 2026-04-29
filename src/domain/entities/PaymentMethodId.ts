import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Stripe Payment Method ID. Always begins with `pm_` followed by an opaque
 * alphanumeric body. Identifies a saved payment instrument (a card, mostly)
 * attached to a rider's `StripeCustomerId`.
 *
 * Branded so a `PaymentMethodId` cannot be passed where a `StripeCustomerId`
 * or `StripeAccountId` is expected. The Stripe microservice routes by the
 * specific id type (`/customer-payment-methods` takes a customer id but
 * returns a list of payment-method ids; `/detach-payment-method` takes a
 * payment-method id) and mixing them is a class of bug the type system can
 * prevent.
 *
 * Validity rules:
 *   1. Must begin with the literal prefix `pm_`.
 *   2. Body (after the prefix) must be 1..255 characters of `[A-Za-z0-9]`.
 */
export type PaymentMethodId = Brand<string, 'PaymentMethodId'>;

const PAYMENT_METHOD_ID_PREFIX = 'pm_';
const PAYMENT_METHOD_ID_REGEX = /^pm_[A-Za-z0-9]{1,255}$/;

export const PaymentMethodId = {
  create(value: string): Result<PaymentMethodId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'payment_method_id_not_a_string',
          message: 'PaymentMethodId must be a string',
          field: 'paymentMethodId',
        }),
      );
    }
    if (!value.startsWith(PAYMENT_METHOD_ID_PREFIX)) {
      return Result.err(
        new ValidationError({
          code: 'payment_method_id_invalid_prefix',
          message: `PaymentMethodId must begin with "${PAYMENT_METHOD_ID_PREFIX}"`,
          field: 'paymentMethodId',
        }),
      );
    }
    if (!PAYMENT_METHOD_ID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'payment_method_id_invalid_format',
          message:
            'PaymentMethodId body must be 1..255 alphanumeric characters',
          field: 'paymentMethodId',
        }),
      );
    }
    return Result.ok(brand<string, 'PaymentMethodId'>(value));
  },
};
