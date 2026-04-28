import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Money } from './Money';
import type { RideServiceId } from './RideServiceId';
import type { ServiceAreaId } from './ServiceAreaId';

/**
 * A ride tier offered within a `ServiceArea` — e.g. "Economy", "XL",
 * "Premium". Mirrors the legacy
 * `serviceAreas/{areaId}/rideServices/{rideServiceId}` document.
 *
 * Pricing fields use Money (minor units) end-to-end so we can do fare math
 * without floating-point error. The legacy doc stores them as plain numbers
 * in dollars; the mapper converts on the data-layer boundary.
 *
 * `seatCapacity` is the maximum passenger count the tier supports.
 *
 * Pre-trip fare-estimate logic does not live here — it's a domain service
 * (FareCalculator) introduced in Phase 2 turn 3 (ride lifecycle). This
 * entity is just the data carrier.
 */
export interface RideServiceProps {
  readonly id: RideServiceId;
  /** The parent ServiceArea the tier belongs to. Always set by the mapper. */
  readonly areaId: ServiceAreaId;
  readonly name: string;
  readonly description: string;
  readonly baseFare: Money;
  readonly minimumFare: Money;
  readonly cancelationFee: Money;
  /** Passenger seat capacity. Integer ≥ 1. */
  readonly seatCapacity: number;
  readonly costPerKm: Money;
  readonly costPerMinute: Money;
}

const MIN_SEATS = 1;
const MAX_SEATS = 16; // Generous ceiling — covers van / shuttle tiers.

export class RideService {
  private constructor(private readonly props: RideServiceProps) {}

  static create(props: RideServiceProps): Result<RideService, ValidationError> {
    if (
      !Number.isInteger(props.seatCapacity) ||
      props.seatCapacity < MIN_SEATS ||
      props.seatCapacity > MAX_SEATS
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_invalid_seat_capacity',
          message: `seatCapacity must be an integer in [${String(MIN_SEATS)}, ${String(MAX_SEATS)}]`,
          field: 'seatCapacity',
        }),
      );
    }
    if (props.name.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_service_empty_name',
          message: 'name must be a non-empty string',
          field: 'name',
        }),
      );
    }
    return Result.ok(new RideService(props));
  }

  get id(): RideServiceId {
    return this.props.id;
  }
  get areaId(): ServiceAreaId {
    return this.props.areaId;
  }
  get name(): string {
    return this.props.name;
  }
  get description(): string {
    return this.props.description;
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
  get seatCapacity(): number {
    return this.props.seatCapacity;
  }
  get costPerKm(): Money {
    return this.props.costPerKm;
  }
  get costPerMinute(): Money {
    return this.props.costPerMinute;
  }
}
