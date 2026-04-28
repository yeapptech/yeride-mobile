import type { Money } from '../entities/Money';
import { Money as MoneyClass } from '../entities/Money';
import type { RideService } from '../entities/RideService';
import type { RideServiceSnapshot } from '../entities/RideServiceSnapshot';
import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * Domain service for fare math. Pure function — no I/O, no clocks, no
 * collaborators beyond the input data.
 *
 * Mirrors the legacy yeride `calculateRangeFare` formula exactly:
 *
 *   distanceCost = (distanceMeters / 1000) * costPerKm
 *   durationCost = (durationSeconds / 60)  * costPerMinute
 *   raw          = baseFare + distanceCost + durationCost
 *   fare         = max(raw, minimumFare)
 *
 * Money math runs in MINOR UNITS so we never accumulate floating-point
 * error. The intermediate per-km / per-minute multiplications use
 * `Money.multiply(factor)` which rounds half-to-even via Math.round.
 *
 * Both the full `RideService` entity (catalog tier) and the
 * `RideServiceSnapshot` (denormalized on a Ride) are accepted via a
 * structural type so the same calculator works pre-trip (estimating from
 * a service the rider just selected) and post-trip (validating fare
 * against the snapshot baked on the trip).
 */

interface FarePricing {
  readonly baseFare: Money;
  readonly minimumFare: Money;
  readonly costPerKm: Money;
  readonly costPerMinute: Money;
}

export interface FareEstimateInput {
  readonly rideService: FarePricing | RideService | RideServiceSnapshot;
  /** Distance in METRES (matches Routes API native unit). */
  readonly distanceMeters: number;
  /** Duration in SECONDS (matches Routes API native unit). */
  readonly durationSeconds: number;
}

export const FareCalculator = {
  /**
   * Compute the fare for a trip of the given distance + duration on the
   * given ride-service tier. Failures are reported via Result rather than
   * throwing.
   */
  estimate(input: FareEstimateInput): Result<Money, ValidationError> {
    if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) {
      return Result.err(
        new ValidationError({
          code: 'fare_invalid_distance',
          message: 'distanceMeters must be a non-negative finite number',
          field: 'distanceMeters',
        }),
      );
    }
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds < 0) {
      return Result.err(
        new ValidationError({
          code: 'fare_invalid_duration',
          message: 'durationSeconds must be a non-negative finite number',
          field: 'durationSeconds',
        }),
      );
    }

    const { baseFare, minimumFare, costPerKm, costPerMinute } =
      input.rideService;

    const distanceCostR = costPerKm.multiply(input.distanceMeters / 1000);
    if (!distanceCostR.ok) return distanceCostR;
    const durationCostR = costPerMinute.multiply(input.durationSeconds / 60);
    if (!durationCostR.ok) return durationCostR;

    const subtotalR = baseFare.add(distanceCostR.value);
    if (!subtotalR.ok) return subtotalR;
    const rawFareR = subtotalR.value.add(durationCostR.value);
    if (!rawFareR.ok) return rawFareR;

    const rawFare = rawFareR.value;
    const finalMinor =
      rawFare.minorUnits < minimumFare.minorUnits
        ? minimumFare.minorUnits
        : rawFare.minorUnits;

    return MoneyClass.create(finalMinor, rawFare.currency);
  },
};
