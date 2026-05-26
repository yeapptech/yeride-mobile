import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { CancellationReason } from './CancellationReason';
import type { DriverSnapshot } from './DriverSnapshot';
import type { Endpoint } from './Endpoint';
import type { PassengerSnapshot } from './PassengerSnapshot';
import type { PaymentFailure } from './PaymentFailure';
import type { RideId } from './RideId';
import type { RideServiceSnapshot } from './RideServiceSnapshot';
import type { RideStatus } from './RideStatus';
import type { Route } from './Route';

/**
 * The trip aggregate. Carries every field the legacy yeride app writes to
 * `trips/{tripId}` so the rewrite reads + writes documents the legacy app
 * also processes.
 *
 * State machine transitions are exposed as methods that return
 * `Result<Ride, ValidationError>` — illegal transitions (e.g. completing a
 * trip that hasn't started) are rejected with a descriptive code rather
 * than throwing. The entity is immutable: every transition returns a new
 * `Ride` instance with the updated state.
 *
 * Lifecycle (primary path):
 *
 *     awaiting_driver
 *           │ dispatch(driver, pickupRoute)
 *           ▼
 *     dispatched
 *           │ start(odometer)
 *           ▼
 *     started
 *           │ requestPayment(odometer)   ← Cloud Function side
 *           ▼
 *     payment_requested
 *           │ markCompleted()            ← Stripe webhook side
 *           ▼
 *     completed (terminal)
 *
 *     <any active state> ──cancel(reason, by)──▶ cancelled (terminal)
 *
 * The `scheduled` / `scheduled_driver_accepted` / `payment_failed` states
 * are reachable via the data layer (legacy reads / Cloud Function writes)
 * but aren't transitioned to by this entity directly. The construction
 * factory accepts them so we can hydrate any legacy doc.
 *
 * Cancellation can come from either party. The role-specific allowed-set
 * check (e.g. only riders can cite `'driver_no_show'`) is enforced at the
 * `CancelRideByRider` / `CancelRideByDriver` use-case boundary, not here.
 *
 * Rationale for snapshot fields: legacy denormalizes `passenger`,
 * `driver`, and `rideService` onto the trip. We carry all three as full
 * value objects so the trip is self-contained — neither the rider's UI
 * nor the driver's UI needs a second Firestore read to display the other
 * party.
 */

export interface RidePickupTiming {
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  /** Odometer reading in metres at the moment the rider was picked up. */
  readonly odometerMeters: number | null;
  /** Wall-clock seconds from dispatch → pickup-completed. */
  readonly elapsedSeconds: number | null;
}

export interface RideDropoffTiming {
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  /** Odometer reading at trip completion. */
  readonly odometerMeters: number | null;
}

export interface RideCancellation {
  readonly reason: CancellationReason;
  readonly by: 'rider' | 'driver';
  readonly at: Date;
  /** Captured at cancel time so the cancel Cloud Function can compute fees. */
  readonly odometerMeters: number | null;
}

export interface RideRoutePreference {
  readonly avoidTolls: boolean;
  readonly selectedRouteSummary: string | null;
  readonly routeToken: string | null;
}

export interface RideProps {
  readonly id: RideId;
  readonly status: RideStatus;
  readonly passenger: PassengerSnapshot;
  readonly driver: DriverSnapshot | null;
  readonly rideService: RideServiceSnapshot;
  readonly pickup: Endpoint;
  readonly dropoff: Endpoint;
  readonly createdAt: Date;
  readonly pickupTiming: RidePickupTiming;
  readonly dropoffTiming: RideDropoffTiming;
  readonly cancellation: RideCancellation | null;
  readonly routePreference: RideRoutePreference | null;
  /**
   * Future pickup datetime for a `'scheduled'` ride. `null` for the
   * default "now" rides created by `Ride.create`. Set by
   * `Ride.createScheduled` and read by the rider's Scheduled section on
   * the Activity tab. The Cloud Function reads this as a Firestore
   * Timestamp via `.toDate()` for the pickup-reminder Cloud Task (see
   * `yeride-functions/handlers/trip-created.js:121`), so the mapper
   * write path must persist it as a Timestamp, not an ISO string.
   *
   * Immutable after construction — the rewrite doesn't support
   * re-scheduling an existing ride (matches legacy parity). To
   * re-schedule, the rider cancels and creates a new ride.
   */
  readonly schedulePickupAt: Date | null;
  /**
   * Phase 10 Turn 10.5 — structured payment failure detail. Non-null
   * when the synchronous payment path (yeride-functions
   * `processPayment` → yeride-stripe-server `/direct-charge`) errored
   * before a Stripe `PaymentIntent` was created. The trigger-side
   * catch block flips `status` to `'payment_failed'` AND writes
   * `paymentError: {code, message, occurredAt}` in the same Firestore
   * update — both fields move together. Carries a typed `code` so
   * `PaymentFailedView` can surface actionable copy (e.g. "Add a
   * payment method" vs. "Your card was declined") instead of a
   * generic error.
   *
   * Distinct from the Stripe-async failure path: when a
   * `PaymentIntent` IS created but the charge later fails, the
   * Stripe webhook flips status to `'payment_failed'` WITHOUT
   * writing this field (the webhook server is purposely thin on
   * structured-error context — the existing `payment.decline_code`
   * pattern is what surfaces there). On both paths the view falls
   * back to a generic message when `paymentFailure === null`.
   */
  readonly paymentFailure: PaymentFailure | null;
}

/**
 * Domain rule for scheduled-ride construction: the requested pickup
 * datetime must be at least this many minutes in the future relative to
 * `createdAt`. Mirrors legacy `ScheduleDatetimePicker`'s
 * `minimumMinutes = 15` (see
 * `yeride/src/components/ScheduleDatetimePicker.js`).
 */
export const SCHEDULED_RIDE_MIN_LEAD_MINUTES = 15;

/**
 * Symmetric upper bound on scheduled-ride lead time. A pickup more
 * than this many days out is almost certainly a UI mishap or a bad
 * actor — Cloud Tasks tolerates the delay but the dispatch pipeline
 * (driver-pull model, no offer-timeout) doesn't, and a 5-year-out
 * trip would clutter the rider's Activity tab indefinitely.
 *
 * 30 days is a generous-but-finite ceiling — covers realistic
 * "next month's flight" scheduling, rejects anything weirder.
 * Symmetric ValidationError `ride_invalid_schedule` so the picker
 * surface uses the same surface as the floor check.
 */
export const SCHEDULED_RIDE_MAX_LEAD_DAYS = 30;

export class Ride {
  private constructor(private readonly props: RideProps) {}

  /** Hydrate a Ride from any legacy trip document shape. Total over
   *  already-validated value objects. */
  static fromProps(props: RideProps): Result<Ride, ValidationError> {
    return Result.ok(new Ride(props));
  }

  /** Construct a brand-new ride at the start of the lifecycle.
   *  Equivalent to legacy `createTrip(...)` minus the Firestore write. */
  static create(args: {
    id: RideId;
    passenger: PassengerSnapshot;
    rideService: RideServiceSnapshot;
    pickup: Endpoint;
    dropoff: Endpoint;
    createdAt: Date;
    routePreference?: RideRoutePreference | null;
  }): Result<Ride, ValidationError> {
    return Result.ok(
      new Ride({
        id: args.id,
        status: 'awaiting_driver',
        passenger: args.passenger,
        driver: null,
        rideService: args.rideService,
        pickup: args.pickup,
        dropoff: args.dropoff,
        createdAt: args.createdAt,
        pickupTiming: {
          startedAt: null,
          completedAt: null,
          odometerMeters: null,
          elapsedSeconds: null,
        },
        dropoffTiming: {
          startedAt: null,
          completedAt: null,
          odometerMeters: null,
        },
        cancellation: null,
        routePreference: args.routePreference ?? null,
        schedulePickupAt: null,
        paymentFailure: null,
      }),
    );
  }

  /**
   * Construct a brand-new SCHEDULED ride — the rider picked a future
   * pickup time, the trip is persisted in `'scheduled'` status, and the
   * RiderHome auto-redirect deliberately ignores this status (the rider
   * hasn't been matched yet; see
   * `useInProgressRideQuery.ACTIVE_STATUSES`). Once a driver accepts the
   * scheduled trip the Cloud Function flips the status to
   * `'scheduled_driver_accepted'`, at which point the active-redirect
   * fires and the rider lands on RideMonitor.
   *
   * Validation rule: `schedulePickupAt` must be at least
   * `SCHEDULED_RIDE_MIN_LEAD_MINUTES` (=15) minutes after `createdAt`.
   * Mirrors legacy `ScheduleDatetimePicker.minimumMinutes`. Rejected
   * with `ValidationError({code: 'ride_invalid_schedule', …})` —
   * surfaced at the picker UI as "Pickup must be at least 15 minutes
   * from now" rather than crashing the screen.
   *
   * Intentionally NOT a transition from an existing `awaiting_driver`
   * ride — scheduling is a creation-time decision. Re-scheduling isn't
   * supported (legacy parity); the rider cancels and re-creates.
   */
  static createScheduled(args: {
    id: RideId;
    passenger: PassengerSnapshot;
    rideService: RideServiceSnapshot;
    pickup: Endpoint;
    dropoff: Endpoint;
    createdAt: Date;
    schedulePickupAt: Date;
    routePreference?: RideRoutePreference | null;
  }): Result<Ride, ValidationError> {
    if (
      !(args.schedulePickupAt instanceof Date) ||
      Number.isNaN(args.schedulePickupAt.getTime())
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_schedule',
          message: 'schedulePickupAt must be a valid Date',
          field: 'schedulePickupAt',
        }),
      );
    }
    const minMillis =
      args.createdAt.getTime() + SCHEDULED_RIDE_MIN_LEAD_MINUTES * 60_000;
    if (args.schedulePickupAt.getTime() < minMillis) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_schedule',
          message: `schedulePickupAt must be at least ${SCHEDULED_RIDE_MIN_LEAD_MINUTES} minutes after createdAt`,
          field: 'schedulePickupAt',
        }),
      );
    }
    const maxMillis =
      args.createdAt.getTime() +
      SCHEDULED_RIDE_MAX_LEAD_DAYS * 24 * 60 * 60 * 1000;
    if (args.schedulePickupAt.getTime() > maxMillis) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_schedule',
          message: `schedulePickupAt must be at most ${SCHEDULED_RIDE_MAX_LEAD_DAYS} days after createdAt`,
          field: 'schedulePickupAt',
        }),
      );
    }
    return Result.ok(
      new Ride({
        id: args.id,
        status: 'scheduled',
        passenger: args.passenger,
        driver: null,
        rideService: args.rideService,
        pickup: args.pickup,
        dropoff: args.dropoff,
        createdAt: args.createdAt,
        pickupTiming: {
          startedAt: null,
          completedAt: null,
          odometerMeters: null,
          elapsedSeconds: null,
        },
        dropoffTiming: {
          startedAt: null,
          completedAt: null,
          odometerMeters: null,
        },
        cancellation: null,
        routePreference: args.routePreference ?? null,
        schedulePickupAt: args.schedulePickupAt,
        paymentFailure: null,
      }),
    );
  }

  /* ────────── property accessors ────────── */

  get id(): RideId {
    return this.props.id;
  }
  get status(): RideStatus {
    return this.props.status;
  }
  get passenger(): PassengerSnapshot {
    return this.props.passenger;
  }
  get driver(): DriverSnapshot | null {
    return this.props.driver;
  }
  get rideService(): RideServiceSnapshot {
    return this.props.rideService;
  }
  get pickup(): Endpoint {
    return this.props.pickup;
  }
  get dropoff(): Endpoint {
    return this.props.dropoff;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get pickupTiming(): RidePickupTiming {
    return this.props.pickupTiming;
  }
  get dropoffTiming(): RideDropoffTiming {
    return this.props.dropoffTiming;
  }
  get cancellation(): RideCancellation | null {
    return this.props.cancellation;
  }
  get routePreference(): RideRoutePreference | null {
    return this.props.routePreference;
  }
  get schedulePickupAt(): Date | null {
    return this.props.schedulePickupAt;
  }
  get paymentFailure(): PaymentFailure | null {
    return this.props.paymentFailure;
  }

  /* ────────── transitions ────────── */

  /**
   * Driver accepts the ride. Sets the driver snapshot, attaches pickup
   * directions (driver → pickup), records `pickupTiming.startedAt`, and
   * flips status to `'dispatched'`.
   */
  dispatch(args: {
    driver: DriverSnapshot;
    pickupDirections: Route;
    at: Date;
  }): Result<Ride, ValidationError> {
    if (this.props.status !== 'awaiting_driver') {
      return Result.err(
        illegal(this.props.status, 'dispatch', 'awaiting_driver → dispatched'),
      );
    }
    return Ride.fromProps({
      ...this.props,
      status: 'dispatched',
      driver: args.driver,
      pickup: this.props.pickup.withDirections(args.pickupDirections),
      pickupTiming: {
        ...this.props.pickupTiming,
        startedAt: args.at,
      },
    });
  }

  /**
   * Driver picks up the rider. Records `pickupTiming.completedAt` +
   * `odometer` + `elapsedSeconds`, marks `dropoffTiming.startedAt`, flips
   * status to `'started'`.
   */
  start(args: {
    odometerMeters: number;
    at: Date;
  }): Result<Ride, ValidationError> {
    if (this.props.status !== 'dispatched') {
      return Result.err(
        illegal(this.props.status, 'start', 'dispatched → started'),
      );
    }
    if (!Number.isFinite(args.odometerMeters) || args.odometerMeters < 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_odometer',
          message: 'odometerMeters must be a non-negative finite number',
          field: 'odometerMeters',
        }),
      );
    }
    const startedAt = this.props.pickupTiming.startedAt;
    const elapsedSeconds =
      startedAt !== null
        ? Math.max(
            0,
            Math.round((args.at.getTime() - startedAt.getTime()) / 1000),
          )
        : 0;
    return Ride.fromProps({
      ...this.props,
      status: 'started',
      pickupTiming: {
        ...this.props.pickupTiming,
        completedAt: args.at,
        odometerMeters: args.odometerMeters,
        elapsedSeconds,
      },
      dropoffTiming: {
        ...this.props.dropoffTiming,
        startedAt: args.at,
      },
    });
  }

  /**
   * Driver requests payment. In legacy this transitions to
   * `'payment_requested'`, NOT directly to `'completed'` — the Stripe
   * webhook flips to `'completed'` once the charge succeeds. Records
   * `dropoffTiming.completedAt` + `odometer`.
   */
  requestPayment(args: {
    odometerMeters: number;
    at: Date;
  }): Result<Ride, ValidationError> {
    if (this.props.status !== 'started') {
      return Result.err(
        illegal(
          this.props.status,
          'requestPayment',
          'started → payment_requested',
        ),
      );
    }
    if (!Number.isFinite(args.odometerMeters) || args.odometerMeters < 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_odometer',
          message: 'odometerMeters must be a non-negative finite number',
          field: 'odometerMeters',
        }),
      );
    }
    const startedAt = this.props.pickupTiming.completedAt;
    if (
      startedAt &&
      args.odometerMeters < (this.props.pickupTiming.odometerMeters ?? 0)
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_odometer_decreased',
          message: 'completion odometer must be ≥ pickup-completion odometer',
          field: 'odometerMeters',
        }),
      );
    }
    return Ride.fromProps({
      ...this.props,
      status: 'payment_requested',
      dropoffTiming: {
        ...this.props.dropoffTiming,
        completedAt: args.at,
        odometerMeters: args.odometerMeters,
      },
    });
  }

  /**
   * Stripe webhook side: payment succeeded; ride is terminal.
   */
  markCompleted(): Result<Ride, ValidationError> {
    if (this.props.status !== 'payment_requested') {
      return Result.err(
        illegal(
          this.props.status,
          'markCompleted',
          'payment_requested → completed',
        ),
      );
    }
    return Ride.fromProps({ ...this.props, status: 'completed' });
  }

  /**
   * Stripe webhook side: payment failed; ride moves to retry surface. The
   * rider can either retry (back to `payment_requested`, handled by another
   * call) or cancel.
   */
  markPaymentFailed(): Result<Ride, ValidationError> {
    if (this.props.status !== 'payment_requested') {
      return Result.err(
        illegal(
          this.props.status,
          'markPaymentFailed',
          'payment_requested → payment_failed',
        ),
      );
    }
    return Ride.fromProps({ ...this.props, status: 'payment_failed' });
  }

  /**
   * Cancel the ride. Allowed from any active state; refused if already
   * terminal. The role-allowed check (only riders can use 'driver_no_show'
   * etc.) belongs at the use-case boundary, not here.
   */
  cancel(args: RideCancellation): Result<Ride, ValidationError> {
    if (
      this.props.status === 'completed' ||
      this.props.status === 'cancelled'
    ) {
      return Result.err(
        illegal(this.props.status, 'cancel', 'active → cancelled'),
      );
    }
    if (
      args.odometerMeters !== null &&
      (!Number.isFinite(args.odometerMeters) || args.odometerMeters < 0)
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_invalid_odometer',
          message: 'odometerMeters must be a non-negative finite number',
          field: 'odometerMeters',
        }),
      );
    }
    return Ride.fromProps({
      ...this.props,
      status: 'cancelled',
      cancellation: args,
    });
  }
}

function illegal(
  current: RideStatus,
  op: string,
  expected: string,
): ValidationError {
  return new ValidationError({
    code: 'ride_illegal_transition',
    message: `Cannot ${op} a ride in status "${current}" — expected ${expected}`,
    field: 'status',
  });
}
