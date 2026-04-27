import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Firebase Auth-generated UID. Always 28 alphanumeric characters.
 *
 * Branded so a UserId cannot be passed where (e.g.) a TripId is expected.
 */
export type UserId = Brand<string, 'UserId'>;

const FIREBASE_UID_LENGTH = 28;
const FIREBASE_UID_REGEX = /^[A-Za-z0-9]{28}$/;

export const UserId = {
  create(value: string): Result<UserId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'user_id_not_a_string',
          message: 'UserId must be a string',
          field: 'userId',
        }),
      );
    }
    if (value.length !== FIREBASE_UID_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'user_id_invalid_length',
          message: `UserId must be exactly ${String(FIREBASE_UID_LENGTH)} characters`,
          field: 'userId',
        }),
      );
    }
    if (!FIREBASE_UID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'user_id_invalid_format',
          message: 'UserId must be alphanumeric',
          field: 'userId',
        }),
      );
    }
    return Result.ok(brand<string, 'UserId'>(value));
  },
};
