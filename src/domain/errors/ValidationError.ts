import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * The input did not satisfy the rules of a value object or aggregate.
 * Returned by value-object factories (Email.create, Money.create, ...) and
 * by use cases that perform additional cross-field validation.
 *
 * `field` is optional but encouraged so the presentation layer can highlight
 * the offending input in a form.
 */
export class ValidationError extends DomainError {
  readonly kind: DomainErrorKind = 'validation';
  readonly code: string;
  readonly field?: string | undefined;

  constructor(args: {
    code: string;
    message: string;
    field?: string | undefined;
    cause?: unknown;
  }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
    this.field = args.field;
  }
}
