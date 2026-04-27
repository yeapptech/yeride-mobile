/**
 * Base class for every *expected* failure in the domain or app layers.
 *
 * Concrete subclasses (ValidationError, AuthorizationError, NotFoundError,
 * ConflictError, PaymentError) are the only error types use cases should
 * surface inside Result.err(...). The presentation layer maps these to
 * user-facing toast/alert/copy.
 *
 * Programming errors and infrastructure crashes do NOT extend DomainError —
 * they bubble up as plain Errors and are caught by the React error boundary
 * + Crashlytics.
 */
export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  /**
   * A short, machine-friendly code that survives serialization
   * (e.g. for analytics or for matching in tests).
   */
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export type DomainErrorKind =
  | 'validation'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'payment';
