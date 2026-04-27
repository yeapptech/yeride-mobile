import { Email } from '@domain/entities/Email';
import type { UserId } from '@domain/entities/UserId';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { AuthRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Sign an existing user in. This use case deliberately does NOT load the
 * user's Firestore document — the AppContent-level auth listener picks up
 * the new auth state and the UserRepository subscription kicks in to
 * populate the session store.
 *
 * Returns the new userId on success so callers can decide what to do (the
 * presentation layer typically just lets the navigator route on session
 * state change).
 */
export class LogInUser {
  constructor(private readonly auth: AuthRepository) {}

  async execute(input: {
    email: string;
    password: string;
  }): Promise<
    Result<
      { userId: UserId },
      ValidationError | AuthorizationError | NotFoundError
    >
  > {
    const emailR = Email.create(input.email);
    if (!emailR.ok) return emailR;

    const r = await this.auth.signIn({
      email: emailR.value,
      password: input.password,
    });
    if (!r.ok) return r;

    return Result.ok({ userId: r.value });
  }
}
