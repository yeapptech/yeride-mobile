import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * The resource the caller asked about does not exist (or has been deleted).
 * Distinct from authorization: NotFoundError is used when the *existence* of
 * the resource is itself non-sensitive. If existence is sensitive, prefer
 * AuthorizationError to avoid leaking information.
 */
export class NotFoundError extends DomainError {
  readonly kind: DomainErrorKind = 'not_found';
  readonly code: string;
  readonly resource: string;
  readonly id?: string | undefined;

  constructor(args: {
    code: string;
    message: string;
    resource: string;
    id?: string | undefined;
    cause?: unknown;
  }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
    this.resource = args.resource;
    this.id = args.id;
  }
}
