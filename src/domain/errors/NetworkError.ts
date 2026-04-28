import { DomainError, type DomainErrorKind } from './DomainError';

/**
 * An infrastructure call (HTTPS request, Firestore stream, etc.) failed in a
 * way that's expected to be transient — DNS, timeouts, 5xx responses, broken
 * stream resumption, etc. Distinct from `AuthorizationError` (the call
 * succeeded but the user wasn't allowed) and `NotFoundError` (the call
 * succeeded but the resource isn't there).
 *
 * The presentation layer typically surfaces this as a "Couldn't connect —
 * tap to retry" prompt rather than a hard failure.
 *
 * Use codes like:
 *   - 'routes_request_timeout'
 *   - 'routes_request_failed'        — generic / unmapped HTTP error
 *   - 'firestore_stream_disconnected'
 *
 * `cause` carries the original error (Error / fetch Response / Firestore
 * code) so Crashlytics breadcrumbs can be reconstructed without changing
 * the user-facing surface.
 */
export class NetworkError extends DomainError {
  readonly kind: DomainErrorKind = 'network';
  readonly code: string;

  constructor(args: { code: string; message: string; cause?: unknown }) {
    super(
      args.message,
      args.cause !== undefined ? { cause: args.cause } : undefined,
    );
    this.code = args.code;
  }
}
