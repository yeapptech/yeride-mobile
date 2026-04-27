import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import type { User } from '@domain/entities/User';
import { updateProfile } from '@domain/entities/User';
import {
  AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Update name and/or phone for the currently-signed-in user. Pass `phone:
 * null` to clear it; omit `phone` (or pass undefined) to leave it unchanged.
 */
export class UpdateProfile {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
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

    let name = userR.value.name;
    if (input.firstName !== undefined || input.lastName !== undefined) {
      const nameR = PersonName.create({
        first: input.firstName ?? userR.value.name.first,
        last: input.lastName ?? userR.value.name.last,
      });
      if (!nameR.ok) return nameR;
      name = nameR.value;
    }

    let phone: PhoneNumber | null | undefined;
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') {
        phone = null;
      } else {
        const phoneR = PhoneNumber.create(input.phone);
        if (!phoneR.ok) return phoneR;
        phone = phoneR.value;
      }
    }

    const next = updateProfile(
      userR.value,
      phone === undefined ? { name } : { name, phone },
      this.clock(),
    );

    const writeR = await this.users.update(next);
    if (!writeR.ok) return writeR;
    return Result.ok({ user: writeR.value });
  }
}
