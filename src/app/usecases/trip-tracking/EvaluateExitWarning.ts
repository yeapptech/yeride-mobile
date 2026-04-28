import type { Coordinates } from '@domain/entities/Coordinates';

/**
 * Geofence radius in meters around a pickup or dropoff point. Matches the
 * legacy yeride driver-side geofence (`radius: 200`) so the rewrite stays
 * behaviour-compatible: a user is "inside" the geofence if their live
 * location is within 200m of the anchor.
 *
 * Centralized as a constant so unit tests, view-models, and the
 * BackgroundGeolocation `addGeofences()` call (Phase 4) all reference the
 * same value.
 */
export const GEOFENCE_RADIUS_METERS = 200;

/**
 * Result signal of an exit-warning evaluation.
 *
 *   - 'inside'  : current location is within the geofence radius
 *   - 'exited'  : current location is outside the geofence radius
 *
 * Sticky vs. transition semantics: this signal is computed from a single
 * snapshot of the rider's location. Showing/hiding the actual UI banner
 * is the view-model's job (it tracks transitions and writes to
 * `useGeofenceUiStore`). This use case is pure: same inputs → same output.
 */
export type ExitWarningSignal = 'inside' | 'exited';

export interface EvaluateExitWarningInput {
  /** The user's live position. */
  readonly current: Coordinates;
  /** Pickup or dropoff endpoint coordinates. */
  readonly anchor: Coordinates;
  /**
   * Override the default radius. Caller-supplied radii are clamped to a
   * minimum of 1m (defensive — a zero radius would make every snapshot
   * "exited" and a negative radius is nonsense).
   */
  readonly radiusMeters?: number;
}

export interface EvaluateExitWarningOutput {
  readonly signal: ExitWarningSignal;
  /** Distance from `current` to `anchor` in meters. */
  readonly distanceMeters: number;
  /** The radius the evaluation actually used, after clamping. */
  readonly radiusMeters: number;
}

/**
 * Pure-domain predicate: is a user inside or outside the geofence around an
 * anchor point?
 *
 * Phase 3 wires this in `useRideMonitorViewModel` against the rider's
 * Firestore-backed location. Phase 4 will call the same function from the
 * driver side, fed by `BackgroundGeolocation.onLocation` events.
 *
 * No I/O, no clocks, no side effects — every output is a function of the
 * three inputs.
 */
export class EvaluateExitWarning {
  execute(input: EvaluateExitWarningInput): EvaluateExitWarningOutput {
    const radius = Math.max(1, input.radiusMeters ?? GEOFENCE_RADIUS_METERS);
    const distance = input.current.distanceTo(input.anchor);
    return {
      signal: distance <= radius ? 'inside' : 'exited',
      distanceMeters: distance,
      radiusMeters: radius,
    };
  }
}
