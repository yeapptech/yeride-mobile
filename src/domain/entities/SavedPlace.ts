import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

import type { Address } from './Address';

/**
 * A user's saved place ("Home", "Work", "Mom's house"). Identified by a
 * place_id (typically Google's, but we don't enforce — just a non-empty
 * string we control as a logical key).
 *
 * The user-visible label is separate from the address so two saved places
 * can share an address (e.g. one labelled "Home", one "Mom's house"). Labels
 * are deduplicated case-insensitively per user — enforced in use cases, not
 * here.
 */

export type SavedPlaceId = Brand<string, 'SavedPlaceId'>;

const ID_MIN_LENGTH = 1;
const ID_MAX_LENGTH = 200;
const LABEL_MAX_LENGTH = 60;

export const SavedPlaceId = {
  create(value: string): Result<SavedPlaceId, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'saved_place_id_not_a_string',
          message: 'SavedPlaceId must be a string',
          field: 'savedPlaceId',
        }),
      );
    }
    const trimmed = value.trim();
    if (trimmed.length < ID_MIN_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'saved_place_id_empty',
          message: 'SavedPlaceId is required',
          field: 'savedPlaceId',
        }),
      );
    }
    if (trimmed.length > ID_MAX_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'saved_place_id_too_long',
          message: `SavedPlaceId exceeds maximum length of ${String(ID_MAX_LENGTH)}`,
          field: 'savedPlaceId',
        }),
      );
    }
    return Result.ok(brand<string, 'SavedPlaceId'>(trimmed));
  },
};

export class SavedPlace {
  private constructor(
    public readonly id: SavedPlaceId,
    public readonly label: string,
    public readonly address: Address,
  ) {}

  static create(args: {
    id: SavedPlaceId;
    label: string;
    address: Address;
  }): Result<SavedPlace, ValidationError> {
    if (typeof args.label !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'saved_place_label_not_a_string',
          message: 'Saved-place label must be a string',
          field: 'label',
        }),
      );
    }
    const label = args.label.trim();
    if (label.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'saved_place_label_empty',
          message: 'Saved-place label is required',
          field: 'label',
        }),
      );
    }
    if (label.length > LABEL_MAX_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'saved_place_label_too_long',
          message: `Saved-place label exceeds maximum length of ${String(LABEL_MAX_LENGTH)}`,
          field: 'label',
        }),
      );
    }
    return Result.ok(new SavedPlace(args.id, label, args.address));
  }

  /** Return a copy with a different label. */
  withLabel(newLabel: string): Result<SavedPlace, ValidationError> {
    return SavedPlace.create({
      id: this.id,
      label: newLabel,
      address: this.address,
    });
  }

  /** Return a copy with a different address. */
  withAddress(newAddress: Address): SavedPlace {
    return new SavedPlace(this.id, this.label, newAddress);
  }

  equals(other: SavedPlace): boolean {
    return (
      this.id === other.id &&
      this.label === other.label &&
      this.address.equals(other.address)
    );
  }
}
