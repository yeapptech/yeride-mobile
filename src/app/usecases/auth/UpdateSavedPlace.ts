import { Address } from '@domain/entities/Address';
import { Coordinates } from '@domain/entities/Coordinates';
import { SavedPlaceId, type SavedPlace } from '@domain/entities/SavedPlace';
import {
  AuthorizationError,
  NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Update an existing saved place. Identifies the place by `placeId`. All
 * other fields are optional — caller passes only what's changing.
 *
 * Failure modes:
 *   - Place not found → NotFoundError
 *   - Validation on any provided field → ValidationError
 */
export class UpdateSavedPlace {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(input: {
    placeId: string;
    label?: string;
    addressLabel?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<
    Result<
      { place: SavedPlace },
      ValidationError | AuthorizationError | NotFoundError
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

    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;

    const existing = userR.value.savedPlaces.find((p) => p.id === idR.value);
    if (!existing) {
      return Result.err(
        new NotFoundError({
          code: 'saved_place_not_found',
          message: 'Saved place not found',
          resource: 'savedPlace',
          id: idR.value,
        }),
      );
    }

    // Build the next address (if any address field is provided, all coord
    // fields must be too — we don't allow partial coord updates).
    let nextAddress = existing.address;
    if (
      input.addressLabel !== undefined ||
      input.latitude !== undefined ||
      input.longitude !== undefined
    ) {
      const lat = input.latitude ?? existing.address.coordinates.latitude;
      const lng = input.longitude ?? existing.address.coordinates.longitude;
      const label = input.addressLabel ?? existing.address.label;
      const coordsR = Coordinates.create(lat, lng);
      if (!coordsR.ok) return coordsR;
      const addressR = Address.create({ label, coordinates: coordsR.value });
      if (!addressR.ok) return addressR;
      nextAddress = addressR.value;
    }

    const next =
      input.label !== undefined
        ? existing.withLabel(input.label)
        : Result.ok(existing);
    if (!next.ok) return next;

    const finalPlace = next.value.withAddress(nextAddress);

    const writeR = await this.users.updateSavedPlace({
      userId: uid,
      place: finalPlace,
    });
    if (!writeR.ok) return writeR;
    return Result.ok({ place: writeR.value });
  }
}
