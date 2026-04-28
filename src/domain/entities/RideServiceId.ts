import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Identifier for a RideService document — the document ID of a child of
 * `serviceAreas/{areaId}/rideServices/{rideServiceId}`. Legacy values are
 * slugs like "economy", "premium", "xl", "comfort_plus".
 *
 * Branded so it cannot be confused with a ServiceAreaId.
 *
 * Format: 2..32 lowercase-alphanumeric, with internal hyphens or
 * underscores allowed. Underscores cover legacy stage data (e.g.
 * `comfort_plus`) that predates the rewrite — without this, the
 * Firestore mapper drops those documents on the floor and drivers in
 * affected areas silently miss matching ride offers.
 */
export type RideServiceId = Brand<string, 'RideServiceId'>;

const MIN_LEN = 2;
const MAX_LEN = 32;
const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/;

export const RideServiceId = {
  create(value: string): Result<RideServiceId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'ride_service_id_not_a_string',
          message: 'RideServiceId must be a string',
          field: 'rideServiceId',
        }),
      );
    }
    if (value.length < MIN_LEN || value.length > MAX_LEN) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_id_invalid_length',
          message: `RideServiceId must be ${String(MIN_LEN)}–${String(MAX_LEN)} characters`,
          field: 'rideServiceId',
        }),
      );
    }
    if (!SLUG_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_id_invalid_format',
          message:
            'RideServiceId must be lowercase alphanumeric with internal hyphens or underscores',
          field: 'rideServiceId',
        }),
      );
    }
    return Result.ok(brand<string, 'RideServiceId'>(value));
  },
};
