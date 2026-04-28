import type { Ride } from '@domain/entities/Ride';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { UserId } from '@domain/entities/UserId';
import type { NetworkError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * List a passenger's rides, optionally filtered to a status set and capped
 * at a row limit.
 *
 * Used by:
 *   - `useInProgressRideQuery` — RiderHome resumption (`statuses: [active]`,
 *     `limit: 1`).
 *   - Future Activity tab — full history (`statuses` omitted, server
 *     orders by `createdAt desc`).
 *
 * Server-side filtering happens in the adapter (Firestore `where status in
 * [...]` query); this use case just forwards.
 */
export class ListRidesByPassenger {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    passengerId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>> {
    return this.repo.listByPassenger(args);
  }
}
