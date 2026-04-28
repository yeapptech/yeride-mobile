import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Coordinates } from './Coordinates';
import type { Route } from './Route';

/**
 * Pickup or dropoff location on a ride. The `location` is the lat/lng pair
 * Google Maps centers on; `address` is the street address rendered in the
 * UI; `placeName` is the optional human label ("Home", "Office",
 * "Miami International"), unset for ad-hoc points.
 *
 * `directions` carries the Route to this endpoint:
 *   - For dropoff: directions from pickup → dropoff (set at trip creation
 *     when the rider picks the dropoff).
 *   - For pickup: directions from driver → pickup (set on dispatch by the
 *     driver app when it queries Routes API).
 *
 * Timing fields (pickup.startedAt / completedAt / odometer / elapsedTime,
 * dropoff.startedAt / completedAt / odometer) live on the `Ride` entity, NOT
 * here, because they're properties of the trip's lifecycle rather than the
 * endpoint itself.
 */
export interface EndpointProps {
  readonly location: Coordinates;
  readonly address: string;
  readonly placeName: string | null;
  readonly directions: Route | null;
}

const ADDRESS_MAX_LEN = 500;
const PLACE_NAME_MAX_LEN = 120;

export class Endpoint {
  private constructor(private readonly props: EndpointProps) {}

  static create(props: EndpointProps): Result<Endpoint, ValidationError> {
    const trimmedAddress = props.address.trim();
    if (trimmedAddress.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'endpoint_empty_address',
          message: 'address must be a non-empty string',
          field: 'address',
        }),
      );
    }
    if (trimmedAddress.length > ADDRESS_MAX_LEN) {
      return Result.err(
        new ValidationError({
          code: 'endpoint_address_too_long',
          message: `address must be ${String(ADDRESS_MAX_LEN)} characters or fewer`,
          field: 'address',
        }),
      );
    }
    if (props.placeName !== null) {
      if (typeof props.placeName !== 'string') {
        return Result.err(
          new ValidationError({
            code: 'endpoint_place_name_not_a_string',
            message: 'placeName must be a string or null',
            field: 'placeName',
          }),
        );
      }
      if (props.placeName.length > PLACE_NAME_MAX_LEN) {
        return Result.err(
          new ValidationError({
            code: 'endpoint_place_name_too_long',
            message: `placeName must be ${String(PLACE_NAME_MAX_LEN)} characters or fewer`,
            field: 'placeName',
          }),
        );
      }
    }
    return Result.ok(new Endpoint(props));
  }

  get location(): Coordinates {
    return this.props.location;
  }
  get address(): string {
    return this.props.address;
  }
  get placeName(): string | null {
    return this.props.placeName;
  }
  get directions(): Route | null {
    return this.props.directions;
  }

  /** Return a new Endpoint with updated directions. Used when dispatch
   *  computes the driver→pickup route. */
  withDirections(directions: Route): Endpoint {
    return new Endpoint({ ...this.props, directions });
  }
}
