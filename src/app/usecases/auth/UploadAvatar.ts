import type { User } from '@domain/entities/User';
import { setAvatarUrl } from '@domain/entities/User';
import {
  AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Upload a new avatar image and persist its URL to the user's profile. The
 * image picker (in presentation) is responsible for handing us a content://
 * or file:// URI; the data adapter is responsible for reading + uploading.
 */
export class UploadAvatar {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    imageUri: string;
  }): Promise<
    Result<{ user: User }, ValidationError | AuthorizationError | NotFoundError>
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

    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;

    const uploadR = await this.users.uploadAvatar({
      userId: uid,
      imageUri: input.imageUri,
    });
    if (!uploadR.ok) return uploadR;

    const next = setAvatarUrl(userR.value, uploadR.value, this.clock());
    const writeR = await this.users.update(next);
    if (!writeR.ok) return writeR;
    return Result.ok({ user: writeR.value });
  }
}
