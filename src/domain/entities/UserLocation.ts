import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Coordinates } from './Coordinates';
import type { RideId } from './RideId';
import type { UserId } from './UserId';

/**
 * Live position record for a user — written by the GPS pipeline (driver
 * during a trip, rider while waiting, etc.) and consumed by the rider's UI
 * to show driver ETA, the geofence-exit warning system, and admin tooling.
 *
 * Mirrors the legacy `locations/{userId}` doc shape so the rewrite
 * coexists with legacy clients writing the same collection.
 *
 * `tripTracking` is only set while the user is the driver of an active
 * trip (status in `['dispatched', 'started']`). It carries the destination
 * coordinates so the consumer can compute ETA without re-fetching the
 * trip doc. Cleared (set to null) when the trip terminates or the user
 * isn't currently a driver.
 *
 * `speed` is metres-per-second from the GPS sensor. May be null when the
 * sensor hasn't established a fix yet (cold start) or when the platform
 * doesn't expose it.
 */

export type TripTrackingStatus = 'dispatched' | 'started';
export type TripTrackingDestinationType = 'pickup' | 'dropoff';

export interface TripTrackingDestination {
  readonly type: TripTrackingDestinationType;
  readonly location: Coordinates;
}

export interface TripTracking {
  readonly tripId: RideId;
  readonly tripStatus: TripTrackingStatus;
  readonly destination: TripTrackingDestination;
}

export interface UserLocationProps {
  readonly userId: UserId;
  readonly location: Coordinates;
  /** Metres per second. Null when the sensor hasn't established a fix. */
  readonly speed: number | null;
  readonly updatedAt: Date;
  readonly tripTracking: TripTracking | null;
}

export class UserLocation {
  private constructor(private readonly props: UserLocationProps) {}

  static create(
    props: UserLocationProps,
  ): Result<UserLocation, ValidationError> {
    if (
      props.speed !== null &&
      (!Number.isFinite(props.speed) || props.speed < 0)
    ) {
      return Result.err(
        new ValidationError({
          code: 'user_location_invalid_speed',
          message: 'speed must be null or a non-negative finite number (m/s)',
          field: 'speed',
        }),
      );
    }
    if (Number.isNaN(props.updatedAt.getTime())) {
      return Result.err(
        new ValidationError({
          code: 'user_location_invalid_updated_at',
          message: 'updatedAt must be a valid Date',
          field: 'updatedAt',
        }),
      );
    }
    return Result.ok(new UserLocation(props));
  }

  get userId(): UserId {
    return this.props.userId;
  }
  get location(): Coordinates {
    return this.props.location;
  }
  get speed(): number | null {
    return this.props.speed;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get tripTracking(): TripTracking | null {
    return this.props.tripTracking;
  }
}
