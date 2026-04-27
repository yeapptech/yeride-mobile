import { Email } from '@domain/entities/Email';
import { setEmail } from '@domain/entities/User';
import {
  AuthorizationError,
  type ConflictError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Change the current user's email. Firebase requires recent reauthentication
 * for this operation, so we take the password as input and reauthenticate
 * before calling updateEmail.
 *
 * After the Auth side succeeds, we mirror the new email into the user's
 * Firestore document and clear the verification flag — Firebase will have
 * already triggered a verification email to the new address.
 *
 * Failure modes:
 *   - Reauthentication fails (wrong password) → AuthorizationError
 *   - New email malformed → ValidationError
 *   - New email in use → ConflictError
 *   - User doc missing (race) → NotFoundError
 */
export class ChangeEmail {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    newEmail: string;
    currentPassword: string;
  }): Promise<
    Result<
      true,
      ValidationError | AuthorizationError | ConflictError | NotFoundError
    >
  > {
    const newEmailR = Email.create(input.newEmail);
    if (!newEmailR.ok) return newEmailR;

    const reauthR = await this.auth.reauthenticate({
      password: input.currentPassword,
    });
    if (!reauthR.ok) return reauthR;

    const updateAuthR = await this.auth.updateEmail({
      newEmail: newEmailR.value,
    });
    if (!updateAuthR.ok) return updateAuthR;

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

    const next = setEmail(userR.value, newEmailR.value, this.clock());
    const writeR = await this.users.update(next);
    if (!writeR.ok) return writeR;

    return Result.ok(true);
  }
}
