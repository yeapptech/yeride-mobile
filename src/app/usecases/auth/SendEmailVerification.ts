import type { AuthorizationError } from '@domain/errors';
import type { AuthRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Send the currently-signed-in user a fresh email-verification message.
 * The EmailVerification screen calls this when the user clicks "Resend".
 *
 * Errors:
 *   - 'auth_no_current_user' if no one is signed in.
 */
export class SendEmailVerification {
  constructor(private readonly auth: AuthRepository) {}

  async execute(): Promise<Result<true, AuthorizationError>> {
    return this.auth.sendEmailVerification();
  }
}
