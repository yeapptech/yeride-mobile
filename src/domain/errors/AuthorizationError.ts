import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * The caller is authenticated but not allowed to perform this action against
 * this resource. Mirrors a 403 from the server. Firestore rules and the
 * client-side AuthorizationPolicy must agree on the same set of decisions.
 */
export class AuthorizationError extends DomainError {
  readonly kind: DomainErrorKind = 'authorization';
  readonly code: string;
  readonly resource?: string | undefined;

  constructor(args: {
    code: string;
    message: string;
    resource?: string | undefined;
    cause?: unknown;
  }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
    this.resource = args.resource;
  }
}
