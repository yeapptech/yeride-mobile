import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Coordinates } from './Coordinates';
import type { Money } from './Money';

/**
 * A driving route between two points, returned by the Routes API.
 *
 * Domain shape — decoupled from the Google response wire format. Adapters
 * are responsible for translating `routes[n]` JSON into this entity.
 *
 * Field notes:
 *   - `distanceMeters` / `durationSeconds` are the SI units used by all
 *     business logic (fare calc, ETA math). Never read the localized text
 *     for math.
 *   - `distanceText` / `durationText` are locale-aware display strings
 *     ("2.3 mi", "7 mins") sourced directly from Google's
 *     `localizedValues`. Kept on the entity because re-deriving them would
 *     duplicate Google's localization for no benefit.
 *   - `encodedPolyline` is the raw Google polyline-encoded string. We do
 *     NOT decode here — decoding happens in presentation when a `MapView`
 *     needs to draw the route (Phase 3).
 *   - `routeLabels` is the literal array Google returns
 *     ('DEFAULT_ROUTE', 'FUEL_EFFICIENT', etc.). Kept as a string array
 *     rather than an enum so unknown labels in future Google API versions
 *     don't crash the adapter.
 *   - `tollPrice` is the monetary toll estimate when the request opted in
 *     (`extraComputations: ['TOLLS']`). `null` when no tolls / not
 *     requested.
 *   - `routeToken` is the opaque identifier Google issues so the Navigation
 *     SDK can replay the EXACT same route at trip time. Persist it on the
 *     trip (Phase 2 turn 3).
 *   - `description` is Google's human-readable route summary ("via I-280").
 */
export interface RouteProps {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly distanceText: string;
  readonly durationText: string;
  readonly encodedPolyline: string;
  readonly startLocation: Coordinates;
  readonly endLocation: Coordinates;
  readonly routeLabels: readonly string[];
  readonly tollPrice: Money | null;
  readonly routeToken: string;
  readonly description: string;
}

export class Route {
  private constructor(private readonly props: RouteProps) {}

  static create(props: RouteProps): Result<Route, ValidationError> {
    if (!Number.isFinite(props.distanceMeters) || props.distanceMeters < 0) {
      return Result.err(
        new ValidationError({
          code: 'route_invalid_distance',
          message: 'distanceMeters must be a non-negative finite number',
          field: 'distanceMeters',
        }),
      );
    }
    if (!Number.isFinite(props.durationSeconds) || props.durationSeconds < 0) {
      return Result.err(
        new ValidationError({
          code: 'route_invalid_duration',
          message: 'durationSeconds must be a non-negative finite number',
          field: 'durationSeconds',
        }),
      );
    }
    return Result.ok(new Route(props));
  }

  get distanceMeters(): number {
    return this.props.distanceMeters;
  }
  get durationSeconds(): number {
    return this.props.durationSeconds;
  }
  get distanceText(): string {
    return this.props.distanceText;
  }
  get durationText(): string {
    return this.props.durationText;
  }
  get encodedPolyline(): string {
    return this.props.encodedPolyline;
  }
  get startLocation(): Coordinates {
    return this.props.startLocation;
  }
  get endLocation(): Coordinates {
    return this.props.endLocation;
  }
  get routeLabels(): readonly string[] {
    return this.props.routeLabels;
  }
  get tollPrice(): Money | null {
    return this.props.tollPrice;
  }
  get routeToken(): string {
    return this.props.routeToken;
  }
  get description(): string {
    return this.props.description;
  }

  /** Convenience: does Google's label set mark this as the default route? */
  isDefault(): boolean {
    return this.routeLabels.includes('DEFAULT_ROUTE');
  }

  /** Convenience: does Google's label set mark this as fuel-efficient? */
  isFuelEfficient(): boolean {
    return this.routeLabels.includes('FUEL_EFFICIENT');
  }
}
