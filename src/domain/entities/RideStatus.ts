import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * Every status string the legacy yeride app writes to `trips/{tripId}.status`.
 * The full set is included so the rewrite can READ any legacy trip — even
 * the rarely-reached states (scheduled flow, payment retry).
 *
 * Status meanings, drawn from legacy CLAUDE.md + Trip.js:
 *   - 'awaiting_driver'           — rider created the trip; queryable by
 *                                   nearby drivers via subscribeAvailableRides.
 *   - 'scheduled'                 — rider pre-booked for a future time;
 *                                   queryable by drivers; promoted to
 *                                   'scheduled_driver_accepted' on accept.
 *   - 'scheduled_driver_accepted' — driver accepted the scheduled slot;
 *                                   the driver manually begins it
 *                                   (→ 'dispatched') when the pickup nears.
 *   - 'dispatched'                — driver en route to pickup. Live tracking
 *                                   is on. pickup.startedAt has been written.
 *   - 'started'                   — driver picked up the rider. dropoff.
 *                                   startedAt + pickup.completedAt are set.
 *                                   Live tracking continues.
 *   - 'payment_requested'         — driver tapped "complete"; the
 *                                   completeTrip Cloud Function recorded the
 *                                   final fare and kicked off Stripe charge.
 *                                   The trip is intermediate here while the
 *                                   Stripe webhook reconciles.
 *   - 'completed'                 — Stripe charge succeeded. Terminal state.
 *   - 'payment_failed'            — Stripe charge failed. The rider can
 *                                   retry from the receipt screen, which
 *                                   moves the trip back to 'payment_requested'.
 *   - 'cancelled'                 — terminal. Set via the cancel Cloud
 *                                   Function (which computes any cancellation
 *                                   fee).
 *
 * Active states (in-progress, the user has UI surface for live updates):
 *   ['awaiting_driver', 'scheduled', 'scheduled_driver_accepted',
 *    'dispatched', 'started', 'payment_requested', 'payment_failed']
 *
 * Terminal states (no further transitions):
 *   ['completed', 'cancelled']
 */
export type RideStatus =
  | 'awaiting_driver'
  | 'scheduled'
  | 'scheduled_driver_accepted'
  | 'dispatched'
  | 'started'
  | 'payment_requested'
  | 'completed'
  | 'payment_failed'
  | 'cancelled';

const ALL_STATUSES: readonly RideStatus[] = [
  'awaiting_driver',
  'scheduled',
  'scheduled_driver_accepted',
  'dispatched',
  'started',
  'payment_requested',
  'completed',
  'payment_failed',
  'cancelled',
];

const ACTIVE_STATUSES: ReadonlySet<RideStatus> = new Set([
  'awaiting_driver',
  'scheduled',
  'scheduled_driver_accepted',
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
]);

const TERMINAL_STATUSES: ReadonlySet<RideStatus> = new Set([
  'completed',
  'cancelled',
]);

export const RideStatus = {
  /** All statuses, in their natural lifecycle order. */
  all(): readonly RideStatus[] {
    return ALL_STATUSES;
  },

  /** Type-safe parse of an arbitrary string. */
  parse(value: unknown): Result<RideStatus, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'ride_status_not_a_string',
          message: 'RideStatus must be a string',
          field: 'status',
        }),
      );
    }
    if (!(ALL_STATUSES as readonly string[]).includes(value)) {
      return Result.err(
        new ValidationError({
          code: 'ride_status_unknown',
          message: `Unknown ride status "${value}"`,
          field: 'status',
        }),
      );
    }
    return Result.ok(value as RideStatus);
  },

  /** Whether the ride is still in flight (more transitions possible). */
  isActive(s: RideStatus): boolean {
    return ACTIVE_STATUSES.has(s);
  },

  /** Whether the ride has reached a terminal state. */
  isTerminal(s: RideStatus): boolean {
    return TERMINAL_STATUSES.has(s);
  },
};
