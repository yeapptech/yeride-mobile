import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * Stripe (or downstream payment provider) rejected the operation. Carries
 * a `providerCode` so we can map known cases to friendly copy in
 * presentation, and a `declineReason` for card-decline flows.
 */
export class PaymentError extends DomainError {
  readonly kind: DomainErrorKind = 'payment';
  readonly code: string;
  readonly providerCode?: string | undefined;
  readonly declineReason?: string | undefined;

  constructor(args: {
    code: string;
    message: string;
    providerCode?: string | undefined;
    declineReason?: string | undefined;
    cause?: unknown;
  }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
    this.providerCode = args.providerCode;
    this.declineReason = args.declineReason;
  }
}
