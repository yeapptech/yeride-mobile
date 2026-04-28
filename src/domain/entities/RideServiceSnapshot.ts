import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Money } from './Money';
import type { RideServiceId } from './RideServiceId';

/**
 * Denormalized ride-service tier baked into `trips/{tripId}.rideService` at
 * trip-creation time. Mirrors the legacy yeride embedding so the trip
 * carries the pricing it was created against, even if the admin later
 * adjusts fares on the active `serviceAreas/{areaId}/rideServices/{id}`
 * doc.
 *
 * Distinct from the full `RideService` entity (which knows its parent
 * `areaId` and lives in the catalog) because legacy trip writes don't
 * include the areaId on the embedded snapshot — only on the parent
 * service-area doc.
 *
 * `seatCapacity` is named after the legacy `seat` field; the data-layer
 * mapper handles the alias.
 */
export interface RideServiceSnapshotProps {
  readonly id: RideServiceId;
  readonly name: string;
  readonly baseFare: Money;
  readonly minimumFare: Money;
  readonly cancelationFee: Money;
  readonly costPerKm: Money;
  readonly costPerMinute: Money;
  readonly seatCapacity: number;
}

const MIN_SEATS = 1;
const MAX_SEATS = 16;

export class RideServiceSnapshot {
  private constructor(private readonly props: RideServiceSnapshotProps) {}

  static create(
    props: RideServiceSnapshotProps,
  ): Result<RideServiceSnapshot, ValidationError> {
    if (
      !Number.isInteger(props.seatCapacity) ||
      props.seatCapacity < MIN_SEATS ||
      props.seatCapacity > MAX_SEATS
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_snapshot_invalid_seat_capacity',
          message: `seatCapacity must be an integer in [${String(MIN_SEATS)}, ${String(MAX_SEATS)}]`,
          field: 'seatCapacity',
        }),
      );
    }
    if (props.name.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_snapshot_empty_name',
          message: 'name must be a non-empty string',
          field: 'name',
        }),
      );
    }
    return Result.ok(new RideServiceSnapshot(props));
  }

  get id(): RideServiceId {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get baseFare(): Money {
    return this.props.baseFare;
  }
  get minimumFare(): Money {
    return this.props.minimumFare;
  }
  get cancelationFee(): Money {
    return this.props.cancelationFee;
  }
  get costPerKm(): Money {
    return this.props.costPerKm;
  }
  get costPerMinute(): Money {
    return this.props.costPerMinute;
  }
  get seatCapacity(): number {
    return this.props.seatCapacity;
  }
}
