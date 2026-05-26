import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * Structured payment-failure detail attached to a `Ride` when the
 * synchronous payment path (yeride-functions `processPayment` →
 * yeride-stripe-server `/direct-charge`) errors before a Stripe
 * `PaymentIntent` is created. Carries a typed domain `code` so the
 * presentation layer can render actionable copy (e.g.
 * "Add a payment method" vs. "Your card was declined") plus the raw
 * server-side `message` and an `occurredAt` timestamp.
 *
 * Phase 10 Turn 10.5 (this turn) introduced the field. Before it, the
 * trigger-path catch block in `lib/payments.js:309` swallowed the error
 * with only an event-doc write — the trip stayed at `'completed'` and
 * the rider had no surface to recover. Now the same catch block flips
 * `trips/{id}.status = 'payment_failed'` and writes the structured
 * `paymentError: {code, message, occurredAt}` field this value object
 * mirrors. The rewrite's `PaymentFailedView` switches on `code` against
 * `KnownPaymentFailureCode` to pick the right copy + CTA.
 *
 * **Naming note.** The kickoff doc proposed `PaymentError` but
 * `src/domain/errors/PaymentError.ts` already exists as a
 * `DomainError` subclass — `PaymentFailure` is the rename that
 * sidesteps the import collision while keeping the same intent.
 *
 * **Code catalog contract** with the server. The codes here match
 * `pickDomainCodeForValidation` in `yeride-functions/lib/payments.js`.
 * If a future turn adds a code on either side, add the matching code
 * to the other side in the same commit. The view's switch falls
 * through to a generic "Please try a different payment method"
 * branch on unknown codes — so a one-sided server-side add degrades
 * to acceptable copy, not a crash.
 */

/**
 * Codes the server-side `pickDomainCodeForValidation` catalog emits
 * for validation failures, plus the small set of Stripe-error codes
 * the catch block resolves from `error.response`/`error.raw` (best
 * effort — the Stripe microservice exposes these as
 * `decline_code: 'card_declined' | 'expired_card' | 'insufficient_funds' | ...`),
 * plus a generic fallback the catch block uses when no other code
 * resolves.
 *
 * Treat this as a CLOSED set the view's switch enumerates. Adding a
 * code is a server+client contract change.
 */
export const KNOWN_PAYMENT_FAILURE_CODES = [
  // Validation codes — server's `pickDomainCodeForValidation` catalog.
  'trip_missing_payment_method',
  'trip_missing_stripe_customer',
  'trip_missing_driver_account',
  'trip_payment_validation_failed',
  // Stripe-error codes resolved from the microservice response shape.
  'card_declined',
  'expired_card',
  'insufficient_funds',
  // Catch-all when neither the validation catalog nor the Stripe shape
  // resolves to one of the above. The view renders a generic
  // "Please try a different payment method" CTA.
  'payment_processing_unknown',
] as const;

export type KnownPaymentFailureCode =
  (typeof KNOWN_PAYMENT_FAILURE_CODES)[number];

export function isKnownPaymentFailureCode(
  code: string,
): code is KnownPaymentFailureCode {
  return (KNOWN_PAYMENT_FAILURE_CODES as readonly string[]).includes(code);
}

export interface PaymentFailureProps {
  /**
   * Domain-level failure code. May be a `KnownPaymentFailureCode` (the
   * view switches on it) or any other string (the view falls through
   * to the generic branch). The factory accepts any non-empty string
   * — we don't reject unknown codes here so a future server-side
   * addition doesn't crash trip reads.
   */
  readonly code: string;
  /**
   * Raw server-side message. Surfaced as secondary copy under the
   * code-driven primary copy in `PaymentFailedView`. May be empty
   * when the server emits a sparse error.
   */
  readonly message: string;
  /** Server-side `serverTimestamp()` resolved at trip-doc write. */
  readonly occurredAt: Date;
}

const MAX_CODE_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 1024;

export class PaymentFailure {
  private constructor(private readonly props: PaymentFailureProps) {}

  static create(
    props: PaymentFailureProps,
  ): Result<PaymentFailure, ValidationError> {
    if (typeof props.code !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_code_not_a_string',
          message: 'PaymentFailure.code must be a string',
          field: 'code',
        }),
      );
    }
    if (props.code.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_empty_code',
          message: 'PaymentFailure.code must not be empty',
          field: 'code',
        }),
      );
    }
    if (props.code.length > MAX_CODE_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_code_too_long',
          message: `PaymentFailure.code must be ≤ ${MAX_CODE_LENGTH} chars`,
          field: 'code',
        }),
      );
    }
    if (typeof props.message !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_message_not_a_string',
          message: 'PaymentFailure.message must be a string',
          field: 'message',
        }),
      );
    }
    if (props.message.length > MAX_MESSAGE_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_message_too_long',
          message: `PaymentFailure.message must be ≤ ${MAX_MESSAGE_LENGTH} chars`,
          field: 'message',
        }),
      );
    }
    if (
      !(props.occurredAt instanceof Date) ||
      Number.isNaN(props.occurredAt.getTime())
    ) {
      return Result.err(
        new ValidationError({
          code: 'payment_failure_invalid_occurred_at',
          message: 'PaymentFailure.occurredAt must be a valid Date',
          field: 'occurredAt',
        }),
      );
    }
    return Result.ok(new PaymentFailure(props));
  }

  get code(): string {
    return this.props.code;
  }
  get message(): string {
    return this.props.message;
  }
  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  /** True when `code` matches one of the known catalog entries. */
  isKnown(): boolean {
    return isKnownPaymentFailureCode(this.props.code);
  }

  equals(other: PaymentFailure): boolean {
    return (
      this.props.code === other.props.code &&
      this.props.message === other.props.message &&
      this.props.occurredAt.getTime() === other.props.occurredAt.getTime()
    );
  }
}
