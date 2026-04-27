import { Address } from '@domain/entities/Address';
import { Coordinates } from '@domain/entities/Coordinates';
import { SavedPlace, SavedPlaceId } from '@domain/entities/SavedPlace';
import {
  AuthorizationError,
  type ConflictError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Add a new saved place ("Home", "Work", ...) to the current user's profile.
 *
 * Input takes raw lat/lng + label strings; we build the value objects here
 * so callers don't need to import the domain layer (presentation friendly).
 */
export class AddSavedPlace {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(input: {
    placeId: string;
    label: string;
    addressLabel: string;
    latitude: number;
    longitude: number;
  }): Promise<
    Result<
      { place: SavedPlace },
      ValidationError | AuthorizationError | ConflictError | NotFoundError
    >
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
    const coordsR = Coordinates.create(input.latitude, input.longitude);
    if (!coordsR.ok) return coordsR;
    const addressR = Address.create({
      label: input.addressLabel,
      coordinates: coordsR.value,
    });
    if (!addressR.ok) return addressR;
    const placeR = SavedPlace.create({
      id: idR.value,
      label: input.label,
      address: addressR.value,
    });
    if (!placeR.ok) return placeR;

    const writeR = await this.users.addSavedPlace({
      userId: uid,
      place: placeR.value,
    });
    if (!writeR.ok) return writeR;
    return Result.ok({ place: writeR.value });
  }
}
