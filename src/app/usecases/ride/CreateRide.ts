import type { Ride } from '@domain/entities/Ride';
import type { ConflictError, ValidationError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Rider creates a new ride. The Ride entity is fully constructed by the
 * caller (presentation builds it from the route-selection screen state),
 * so this use case is a thin authorization-and-write wrapper.
 *
 * Authorization: Firestore rules enforce that the trip's `passenger.id`
 * matches the authenticated user; nothing the client can do here violates
 * that. Surface a ConflictError if the doc id collides (extremely unlikely
 * given Firestore auto-ids).
 */
export class CreateRide {
  constructor(private readonly repo: RideRepository) {}

  execute(ride: Ride): Promise<Result<Ride, ConflictError | ValidationError>> {
    return this.repo.create(ride);
  }
}
