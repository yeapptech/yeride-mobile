import { setEmailVerified } from '@domain/entities/User';
import { AuthorizationError, type NotFoundError } from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Re-check whether the current user has verified their email since last
 * time we asked. If they have, also flip the `emailVerified` flag on their
 * Firestore user doc so other clients see the change without an Auth
 * re-fetch.
 *
 * Returns `verified: boolean`. On a transition from false→true this also
 * updates the user document.
 *
 * Errors:
 *   - 'auth_no_current_user' if no one is signed in.
 *   - 'user_not_found' if Auth says yes but the Firestore doc is gone (rare
 *     race; surfaces so the UI can prompt re-registration).
 */
export class CheckEmailVerified {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<
    Result<{ verified: boolean }, AuthorizationError | NotFoundError>
  > {
    const verifiedR = await this.auth.isCurrentEmailVerified();
    if (!verifiedR.ok) return verifiedR;
    const verified = verifiedR.value;

    if (!verified) return Result.ok({ verified });

    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }

    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;

    if (!userR.value.emailVerified) {
      const updated = setEmailVerified(userR.value, true, this.clock());
      const writeR = await this.users.update(updated);
      if (!writeR.ok) return writeR;
    }

    return Result.ok({ verified });
  }
}
