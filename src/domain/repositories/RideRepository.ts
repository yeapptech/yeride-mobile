import type { CancellationReason } from '../entities/CancellationReason';
import type { Coordinates } from '../entities/Coordinates';
import type { Ride } from '../entities/Ride';
import type { RideId } from '../entities/RideId';
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
   * Persist a transition produced by the entity (`Ride.dispatch`,
   * `Ride.start`, `Ride.markCompleted`, etc.). The full ride is written so
   * the adapter can do whatever transactional work it needs.
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
   * Trips for the given passenger, optionally filtered to a status set.
   * Used by the rider's history + in-progress lists.
   */
  listByPassenger(args: {
    passengerId: UserId;
    statuses?: readonly Ride['status'][];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>>;

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
