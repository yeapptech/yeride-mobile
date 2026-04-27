import { SavedPlaceId } from '@domain/entities/SavedPlace';
import {
  AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Remove a saved place from the current user's profile by id.
 */
export class RemoveSavedPlace {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(input: {
    placeId: string;
  }): Promise<
    Result<true, ValidationError | AuthorizationError | NotFoundError>
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

    const idR = SavedPlaceId.create(input.placeId);
    if (!idR.ok) return idR;

    return this.users.removeSavedPlace({
      userId: uid,
      placeId: idR.value,
    });
  }
}
