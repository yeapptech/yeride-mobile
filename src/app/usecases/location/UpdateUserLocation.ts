import type { UserLocation } from '@domain/entities/UserLocation';
import type { NetworkError } from '@domain/errors';
import type { LocationRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Write a GPS reading for the current user. Called by `AppContent`'s GPS
 * listener (which dedups consecutive identical readings at the listener
 * level — see legacy CLAUDE.md note about background-geolocation firing
 * 2-3× per crossing).
 *
 * Retry-on-transient-error is the adapter's responsibility; this use case
 * is a thin pass-through.
 */
export class UpdateUserLocation {
  constructor(private readonly repo: LocationRepository) {}

  execute(location: UserLocation): Promise<Result<true, NetworkError>> {
    return this.repo.updateLocation(location);
  }
}
