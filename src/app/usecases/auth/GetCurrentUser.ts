import type { User } from '@domain/entities/User';
import { AuthorizationError, type NotFoundError } from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * One-shot read of the current user's profile. Returns AuthorizationError
 * if no user is signed in, or NotFoundError if the auth session exists but
 * the Firestore user doc is missing (a rare race after sign-up).
 *
 * For continuous observation use UserRepository.observeById directly via a
 * presentation-layer query hook (Phase 2 will introduce that pattern).
 */
export class GetCurrentUser {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(): Promise<
    Result<{ user: User }, AuthorizationError | NotFoundError>
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    const r = await this.users.getById(uid);
    if (!r.ok) return r;
    return Result.ok({ user: r.value });
  }
}
