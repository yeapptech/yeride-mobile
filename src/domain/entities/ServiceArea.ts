import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Coordinates } from './Coordinates';
import type { ServiceAreaId } from './ServiceAreaId';

/**
 * A geographic region in which YeRide is operational.
 *
 * Mirrors the legacy `serviceAreas/{id}` document shape exactly so the
 * rewrite can read the same Firestore data without a migration:
 *
 *   {
 *     identifier: string         // e.g. "us-fl-south-florida"
 *     latitude / longitude       // center of the (circular) region
 *     radius: number             // metres
 *     notifyOnEntry / Dwell / Exit  // background-geolocation knobs
 *   }
 *
 * Encoded here as a value object: {center: Coordinates, radiusMeters,
 * notifyOnEntry/Dwell/Exit}. The doc-level `identifier` field becomes
 * `identifier` on the entity, distinct from `id` (the Firestore doc id) so
 * that consumers that key off either still work.
 *
 * `containsPoint` is the entity-level analogue of "is the user inside this
 * service area?" — answered via Haversine distance. Note that the legacy app
 * does NOT do this check (it just takes the first area unconditionally),
 * which the rewrite fixes per Phase 2 turn 1 scope.
 */
export interface ServiceAreaProps {
  readonly id: ServiceAreaId;
  /**
   * Slug stored as a field on the document. May or may not equal `id` (the
   * doc id) — legacy tooling keys off `identifier` while subscriptions key
   * off `id`. We keep both for fidelity.
   */
  readonly identifier: string;
  readonly center: Coordinates;
  /** Service-area radius in metres. */
  readonly radiusMeters: number;
  readonly notifyOnEntry: boolean;
  readonly notifyOnDwell: boolean;
  readonly notifyOnExit: boolean;
}

const MIN_RADIUS_METERS = 100; // 100 m — sanity floor
const MAX_RADIUS_METERS = 5_000_000; // 5_000 km — sanity ceiling

export class ServiceArea {
  private constructor(private readonly props: ServiceAreaProps) {}

  static create(props: ServiceAreaProps): Result<ServiceArea, ValidationError> {
    if (
      !Number.isFinite(props.radiusMeters) ||
      props.radiusMeters < MIN_RADIUS_METERS ||
      props.radiusMeters > MAX_RADIUS_METERS
    ) {
      return Result.err(
        new ValidationError({
          code: 'service_area_invalid_radius',
          message: `radiusMeters must be ${String(MIN_RADIUS_METERS)}..${String(MAX_RADIUS_METERS)}`,
          field: 'radiusMeters',
        }),
      );
    }
    if (props.identifier.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'service_area_empty_identifier',
          message: 'identifier must be a non-empty string',
          field: 'identifier',
        }),
      );
    }
    return Result.ok(new ServiceArea(props));
  }

  get id(): ServiceAreaId {
    return this.props.id;
  }
  get identifier(): string {
    return this.props.identifier;
  }
  get center(): Coordinates {
    return this.props.center;
  }
  get radiusMeters(): number {
    return this.props.radiusMeters;
  }
  get notifyOnEntry(): boolean {
    return this.props.notifyOnEntry;
  }
  get notifyOnDwell(): boolean {
    return this.props.notifyOnDwell;
  }
  get notifyOnExit(): boolean {
    return this.props.notifyOnExit;
  }

  /**
   * Whether the given point lies inside this service area. Uses Haversine
   * distance against `radiusMeters`. Inclusive at the boundary.
   */
  containsPoint(point: Coordinates): boolean {
    return this.center.distanceTo(point) <= this.radiusMeters;
  }
}
