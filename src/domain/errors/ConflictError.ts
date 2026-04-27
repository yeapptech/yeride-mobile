import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * The action is rejected because the system is in a state where it cannot be
 * performed. Examples: trying to start a trip that's already in progress,
 * cancelling a trip that's already completed, registering a VIN that already
 * exists. Mirrors a 409 from the server.
 */
export class ConflictError extends DomainError {
  readonly kind: DomainErrorKind = 'conflict';
  readonly code: string;

  constructor(args: { code: string; message: string; cause?: unknown }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
  }
}
