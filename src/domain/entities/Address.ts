import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Coordinates } from './Coordinates';

/**
 * A pickup or dropoff address: human-readable text plus precise coordinates,
 * plus an optional Google `place_id` for fast re-lookup.
 *
 * The label is the formatted display string (e.g. "1600 Amphitheatre Pkwy,
 * Mountain View, CA 94043, USA"). Empty labels are rejected.
 */

const MAX_LABEL_LENGTH = 500;

export class Address {
  private constructor(
    public readonly label: string,
    public readonly coordinates: Coordinates,
    public readonly placeId: string | null,
  ) {}

  static create(args: {
    label: string;
    coordinates: Coordinates;
    placeId?: string | null | undefined;
  }): Result<Address, ValidationError> {
    if (typeof args.label !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'address_label_not_a_string',
          message: 'Address label must be a string',
          field: 'label',
        }),
      );
    }
    const trimmed = args.label.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'address_label_empty',
          message: 'Address label is required',
          field: 'label',
        }),
      );
    }
    if (trimmed.length > MAX_LABEL_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'address_label_too_long',
          message: `Address label exceeds maximum length of ${String(MAX_LABEL_LENGTH)}`,
          field: 'label',
        }),
      );
    }
    const placeId =
      args.placeId === undefined || args.placeId === null
        ? null
        : args.placeId.trim();
    if (placeId !== null && placeId.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'address_place_id_empty',
          message: 'placeId, if provided, must be non-empty',
          field: 'placeId',
        }),
      );
    }
    return Result.ok(new Address(trimmed, args.coordinates, placeId));
  }

  equals(other: Address): boolean {
    return (
      this.label === other.label &&
      this.coordinates.equals(other.coordinates) &&
      this.placeId === other.placeId
    );
  }
}
