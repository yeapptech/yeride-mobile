import type { CancellationReason } from '../entities/CancellationReason';
import type { Coordinates } from '../entities/Coordinates';
import type { Ride } from '../entities/Ride';
import type { RideId } from '../entities/RideId';
import type { RideListCursor, RidePage } from '../entities/RideListCursor';
import type { RideServiceId } from '../entities/RideServiceId';
import type { TripEvent } from '../entities/TripEvent';
import type { TripPayment } from '../entities/TripPayment';
import type { UserId } from '../entities/UserId';
import type {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Read/write access to `trips/{tripId}` documents and their subcollections.
 * The contract spans both the direct-Firestore operations (create, dispatch,
 * start, observe) and the Cloud Function callables (cancel, requestPayment).
 * The adapter decides which implementation each method gets — domain code
 * doesn't care.
 *
 * Why direct-write + callable on the same interface: the legacy split is an
 * implementation detail driven by trust boundaries (server-side fare math
 * + auth checks); the domain just sees "transition the ride". Hiding that
 * behind one repository keeps the use cases clean.
 *
 * Subscription methods (`observeById`, `subscribeAvailableRides`,
 * `subscribeEvents`, `subscribePayments`) return synchronous unsubscribe
 * functions to satisfy React's effect-cleanup contract.
 */
export interface RideRepository {
  /**
   * Mint a fresh, server-safe RideId without writing anything. Lets callers
   * (the rider's `Ride.create` factory) build a complete Ride aggregate
   * before the repository's `create` writes it. Backed by Firestore's
   * `doc(collection).id` for the real adapter; the in-memory fake
   * generates a Firestore-style 20-char alphanumeric.
   */
  newId(): RideId;

  /**
   * Rider creates a new awaiting_driver ride. Direct Firestore write.
   */
  create(ride: Ride): Promise<Result<Ride, ConflictError | ValidationError>>;

  /** One-shot fetch. NotFound when the trip doc doesn't exist. */
  getById(id: RideId): Promise<Result<Ride, NotFoundError>>;

  /**
   * Live subscription to a single trip. Emits `null` when the doc is
   * removed (rare — admin tooling only). Synchronous unsubscribe.
   */
  observeById(id: RideId, callback: (ride: Ride | null) => void): () => void;

  /**
   * Persist a transition produced by the entity (`Ride.start`,
   * `Ride.markCompleted`, `Ride.attachPickupDirections`, etc.). The full
   * ride is written so the adapter can do whatever transactional work it
   * needs. First-come-first-served claims go through `transitionWithClaim`
   * instead (it guards the status atomically); `update` is a plain write.
   *
   * Cancel + requestPayment do NOT go through `update`; they go through
   * the Cloud Function callables below, which compute server-side state
   * (final fare, cancellation fee) before writing.
   */
  update(
    ride: Ride,
  ): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  >;

  /**
   * Atomically claim/transition a ride, guarding on its current status —
   * the first-come-first-served primitive. The adapter re-reads the ride
   * inside a transaction; if its status no longer equals
   * `expectedFromStatus` (e.g. another driver already claimed it) it
   * returns a `ConflictError('ride_already_taken')` rather than clobbering
   * the assignment. Otherwise it runs `apply` (the entity transition the
   * app layer supplies — e.g. `r => r.claimForDispatch({ driver, at })`)
   * and persists the result.
   *
   * Used by `DispatchRide`, `AcceptScheduledRide`, and `BeginScheduledRide`
   * for true first-wins semantics. The entity transition stays in the app
   * layer; the repository only owns the atomic read-guard-write.
   */
  transitionWithClaim(args: {
    rideId: RideId;
    expectedFromStatus: Ride['status'];
    apply: (current: Ride) => Result<Ride, ValidationError>;
  }): Promise<
    Result<
      Ride,
      ConflictError | NotFoundError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Trips for the given passenger, optionally filtered to a status set,
   * capped at `limit`, and starting after the given `cursor`.
   *
   * Returns a `RidePage` carrying both the rows AND a `nextCursor`
   * (`null` when the end has been reached). The cursor is opaque to
   * callers — only this repository's adapter knows how to interpret it.
   *
   * Used by:
   *   - `useInProgressRideQuery` — RiderHome resumption (`statuses:
   *     [active]`, `limit: 1`), reads `page.rides[0]`.
   *   - Activity tab (Turn 6) — paginated history via
   *     `useInfiniteQuery` keyed on `nextCursor`.
   *
   * Note: the client-side `statuses` filter can shrink a page below the
   * requested `limit`. Callers that need a strict count should issue
   * follow-up pages — matches legacy behavior.
   */
  listByPassenger(args: {
    passengerId: UserId;
    statuses?: readonly Ride['status'][];
    limit?: number;
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>>;

  /**
   * Trips for the given driver, optionally filtered to a status set,
   * capped at `limit`, and starting after the given `cursor`.
   *
   * Rides with no driver yet (`driver === null`, the awaiting_driver
   * state) are excluded — this method is "rides this driver has accepted
   * or completed", not "rides this driver could accept" (that's
   * `subscribeAvailableRides`).
   *
   * Used by:
   *   - `useInProgressDriverRideQuery` — DriverHome resumption
   *     (`statuses: [active]`, `limit: 1`), reads `page.rides[0]`.
   *   - Driver Activity tab (Turn 6) — paginated history via
   *     `useInfiniteQuery` keyed on `nextCursor`.
   */
  listByDriver(args: {
    driverId: UserId;
    statuses?: readonly Ride['status'][];
    limit?: number;
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>>;

  /**
   * Live "rides near me" subscription for drivers. The adapter is
   * responsible for the Firestore `where status in ['awaiting_driver',
   * 'scheduled']` query, the `rideService.id in services` filter, and the
   * client-side Haversine cutoff (50 mi from `driverLocation` in legacy).
   *
   * `driverLocation` is the live driver position from the location pipeline
   * (Phase 2 turn 3c). Pass it as input rather than coupling the
   * subscription to a location source — keeps this contract testable.
   */
  subscribeAvailableRides(args: {
    driverId: UserId;
    services: readonly RideServiceId[];
    driverLocation: Coordinates;
    radiusMeters?: number;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /**
   * Live "rider's scheduled rides" subscription. Emits the rider's
   * trips whose status is `'scheduled'` (pending dispatch) or
   * `'scheduled_driver_accepted'` (driver has accepted, pickup window
   * still in the future). Used by the rider's Activity tab to render
   * the Scheduled section above the recent-rides list.
   *
   * Subscription-shaped (not request/response) because scheduled rides
   * DO mutate while the rider watches them: a driver accepts (status
   * flips from `'scheduled'` → `'scheduled_driver_accepted'`), the
   * pickup window arrives and the Cloud Function flips to
   * `'dispatched'` (drops from this set), or the rider cancels (drops
   * to terminal). Synchronous unsubscribe for React-effect cleanup.
   *
   * The adapter is responsible for the Firestore
   * `where('passenger.id', '==', passengerId) AND
   * where('status', 'in', ['scheduled', 'scheduled_driver_accepted'])`
   * query. Result ordering is intentionally NOT specified server-side
   * (avoids a composite-index deploy at cutover); callers sort
   * client-side by `schedulePickupAt asc` for "next-soonest" UX.
   */
  observeScheduledRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /**
   * Live "driver's accepted scheduled rides" subscription for the driver
   * Home Scheduled section. Emits the driver's trips in
   * `'scheduled_driver_accepted'` (a driver never holds a bare
   * `'scheduled'` ride — those are unaccepted/available). Mutates as the
   * driver begins one (drops to `'dispatched'`) or the rider cancels.
   * Synchronous unsubscribe. Ordering NOT specified server-side; callers
   * sort by `schedulePickupAt asc`.
   */
  observeScheduledRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /**
   * Live "user's in-progress rides" subscription for the Home In-progress
   * section. Passenger LIVE statuses: awaiting_driver, dispatched, started,
   * payment_requested, payment_failed (scheduled* belong to
   * observeScheduledRidesByPassenger; terminals are excluded). Synchronous
   * unsubscribe. Ordering NOT specified server-side; callers sort by
   * createdAt desc.
   */
  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /**
   * Driver-side equivalent. Driver LIVE statuses: dispatched, started,
   * payment_requested, payment_failed (no awaiting_driver — no driver yet;
   * no scheduled_driver_accepted — that's the Scheduled section).
   */
  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /** Audit-log subcollection. Read-only; emits sorted by createdAt asc. */
  subscribeEvents(args: {
    rideId: RideId;
    callback: (events: readonly TripEvent[]) => void;
  }): () => void;

  /**
   * Receipt subcollection. Read-only; emits sorted by createdAt desc so the
   * receipt screen renders newest-first.
   */
  subscribePayments(args: {
    rideId: RideId;
    callback: (payments: readonly TripPayment[]) => void;
  }): () => void;

  /**
   * Driver-side: complete the trip, capturing the final odometer reading.
   * Routes through the `completeTrip` Cloud Function which recalculates
   * the fare from the actual trip data and kicks off the Stripe charge.
   * Returns the updated Ride (in `payment_requested` status) on success.
   */
  requestPayment(args: {
    rideId: RideId;
    odometerMeters: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Cancel a ride. Routes through the `cancelTrip` Cloud Function which
   * applies the cancellation fee (if any) and writes the cancellation row.
   *
   * Role-allowed-codes check — riders can use 'driver_no_show' but not
   * 'passenger_no_show', and vice versa — is enforced by the use cases
   * (`CancelRideByRider` / `CancelRideByDriver`), not here.
   */
  cancel(args: {
    rideId: RideId;
    by: 'rider' | 'driver';
    reason: CancellationReason;
    /** Optional odometer at cancel time. Used for cancellation-fee math. */
    odometerMeters?: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  >;
}
