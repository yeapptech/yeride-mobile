import type { Ride } from '@domain/entities/Ride';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { UserId } from '@domain/entities/UserId';
import type { NetworkError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * List a driver's rides, optionally filtered to a status set and capped
 * at a row limit.
 *
 * Used by:
 *   - `useInProgressDriverRideQuery` — DriverHome resumption
 *     (`statuses: [active]`, `limit: 1`).
 *   - Future driver Activity tab — full history (`statuses` omitted,
 *     server orders by `createdAt desc`).
 *
 * Excludes rides with no driver yet (`driver === null`, the
 * awaiting_driver state) — that's `subscribeAvailableRides`'s territory.
 *
 * Server-side filtering happens in the adapter (`where 'driver.id' ==`
 * + client-side status filter to avoid a composite-index requirement,
 * matching the legacy query pattern); this use case just forwards.
 */
export class ListRidesByDriver {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    driverId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>> {
    return this.repo.listByDriver(args);
  }
}
