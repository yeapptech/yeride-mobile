import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Identifier for a ServiceArea document. Mirrors the legacy yeride
 * `serviceAreas/{id}` document ID — typically a slug like
 * "us-fl-south-florida" or "us-ca-bay-area".
 *
 * Branded so a ServiceAreaId cannot be passed where a UserId, RideServiceId,
 * etc. is expected.
 *
 * Format constraints (intentionally loose to accept legacy slugs):
 *   - 3..64 characters
 *   - lowercase alphanumeric + hyphens
 */
export type ServiceAreaId = Brand<string, 'ServiceAreaId'>;

const MIN_LEN = 3;
const MAX_LEN = 64;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const ServiceAreaId = {
  create(value: string): Result<ServiceAreaId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'service_area_id_not_a_string',
          message: 'ServiceAreaId must be a string',
          field: 'serviceAreaId',
        }),
      );
    }
    if (value.length < MIN_LEN || value.length > MAX_LEN) {
      return Result.err(
        new ValidationError({
          code: 'service_area_id_invalid_length',
          message: `ServiceAreaId must be ${String(MIN_LEN)}–${String(MAX_LEN)} characters`,
          field: 'serviceAreaId',
        }),
      );
    }
    if (!SLUG_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'service_area_id_invalid_format',
          message:
            'ServiceAreaId must be lowercase alphanumeric with internal hyphens',
          field: 'serviceAreaId',
        }),
      );
    }
    return Result.ok(brand<string, 'ServiceAreaId'>(value));
  },
};
