import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Identifier for a `trips/{tripId}` document. Legacy yeride uses Firestore
 * auto-generated IDs (20-character alphanumeric strings), but a few legacy
 * trips and Cloud Functions have written longer / shorter ids in tests, so
 * we keep the format constraint loose to avoid rejecting real production
 * data on read.
 *
 * Branded so a RideId cannot be passed where a UserId / VehicleId / etc.
 * is expected.
 */
export type RideId = Brand<string, 'RideId'>;

const MIN_LEN = 6;
const MAX_LEN = 64;
const FIRESTORE_DOC_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export const RideId = {
  create(value: string): Result<RideId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'ride_id_not_a_string',
          message: 'RideId must be a string',
          field: 'rideId',
        }),
      );
    }
    if (value.length < MIN_LEN || value.length > MAX_LEN) {
      return Result.err(
        new ValidationError({
          code: 'ride_id_invalid_length',
          message: `RideId must be ${String(MIN_LEN)}–${String(MAX_LEN)} characters`,
          field: 'rideId',
        }),
      );
    }
    if (!FIRESTORE_DOC_ID_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'ride_id_invalid_format',
          message:
            'RideId must contain only Firestore-doc-safe characters (alphanumeric, underscore, hyphen)',
          field: 'rideId',
        }),
      );
    }
    return Result.ok(brand<string, 'RideId'>(value));
  },
};
