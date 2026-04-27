import { Email } from '@domain/entities/Email';
import type { ValidationError } from '@domain/errors';
import type { AuthRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Send a password-reset email to the given address. Does NOT require the
 * user to be signed in (it's the recovery path).
 *
 * Always returns success when the email format is valid — Firebase Auth
 * deliberately doesn't reveal whether the address exists, to prevent
 * account enumeration.
 */
export class ResetPassword {
  constructor(private readonly auth: AuthRepository) {}

  async execute(input: {
    email: string;
  }): Promise<Result<true, ValidationError>> {
    const emailR = Email.create(input.email);
    if (!emailR.ok) return emailR;
    return this.auth.sendPasswordResetEmail(emailR.value);
  }
}
