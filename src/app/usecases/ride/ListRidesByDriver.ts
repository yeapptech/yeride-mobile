import type { RideListCursor, RidePage } from '@domain/entities/RideListCursor';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { UserId } from '@domain/entities/UserId';
import type { NetworkError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * List a driver's rides, optionally filtered to a status set, capped at
 * a row limit, and resuming after the given `cursor`.
 *
 * Returns a `RidePage` carrying both the rows AND the `nextCursor` (or
 * `null` at end-of-list). The cursor is opaque to callers.
 *
 * Used by:
 *   - `useInProgressDriverRideQuery` — DriverHome resumption
 *     (`statuses: [active]`, `limit: 1`), reads `page.rides[0]`.
 *   - Driver Activity tab (Turn 6) — paginated history via
 *     `useInfiniteQuery` keyed on `nextCursor`.
 *
 * Excludes rides with no driver yet (`driver === null`, the
 * awaiting_driver state) — that's `subscribeAvailableRides`'s territory.
 */
export class ListRidesByDriver {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    driverId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>> {
    return this.repo.listByDriver(args);
  }
}
