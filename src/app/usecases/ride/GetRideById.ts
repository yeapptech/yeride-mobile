import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { NotFoundError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * One-shot read of a ride by id.
 *
 * Used by:
 *   - `useRideQuery` — TanStack Query factory for read-only screens like
 *     RideReceipt that don't need a live subscription.
 *   - Deep-link handlers — synchronous "does this ride exist?" check
 *     before deciding which screen to mount.
 *
 * Live updates flow through `ObserveRide` instead. The two are
 * intentionally distinct: a query and a subscription have different
 * cache, retry, and Suspense semantics in TanStack Query.
 */
export class GetRideById {
  constructor(private readonly repo: RideRepository) {}

  execute(id: RideId): Promise<Result<Ride, NotFoundError>> {
    return this.repo.getById(id);
  }
}
