import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Endpoint } from '@domain/entities/Endpoint';
import type { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { Ride, type RideRoutePreference } from '@domain/entities/Ride';
import type { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { ConflictError, ValidationError } from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Rider creates a new ride.
 *
 * The use case owns the full lifecycle of creating a Ride from
 * presentation-supplied parts:
 *
 *   1. Mint a fresh `RideId` via `repo.newId()` (Firestore auto-id under
 *      the hood; in-memory equivalent in tests).
 *   2. Construct the `Ride` aggregate via `Ride.create(...)` —
 *      `awaiting_driver` status, no driver, no cancellation, no timing.
 *   3. Persist via `repo.create(...)`.
 *
 * Why the use case mints the id rather than the view-model: keeps the
 * presentation layer free of a `RideRepository` dependency. The view-model
 * passes "what kind of trip the rider wants" — this use case turns that
 * spec into a persisted aggregate.
 *
 * Authorization: Firestore rules enforce that the trip's `passenger.id`
 * matches the authenticated user; nothing the client can do here violates
 * that. Surface a `ConflictError` if the doc id collides (extremely
 * unlikely with Firestore auto-ids).
 *
 * Phase 6's payment surface will likely thread a `defaultPaymentMethod`
 * Stripe id through `passenger`. The Ride entity already accepts it via
 * the snapshot — no changes needed here.
 */

export interface CreateRideInput {
  readonly passenger: PassengerSnapshot;
  readonly rideService: RideServiceSnapshot;
  readonly pickup: Endpoint;
  readonly dropoff: Endpoint;
  readonly createdAt: Date;
  readonly routePreference?: RideRoutePreference | null;
  /**
   * Initial driver snapshot — null for awaiting-driver rides (the
   * default). Phase 5+ may pass a pre-assigned driver for fleet-mode
   * rides.
   */
  readonly driver?: DriverSnapshot | null;
  /**
   * Future pickup datetime. When provided (and non-null) the use case
   * routes through `Ride.createScheduled` instead of `Ride.create`,
   * producing a `'scheduled'` ride that the rider sees on the
   * Activity tab's Scheduled section. Missing/null = the default
   * "right now" ride.
   *
   * The 15-minute-from-`createdAt` floor is enforced by
   * `Ride.createScheduled` (legacy parity); a too-soon value surfaces
   * as `ValidationError({code: 'ride_invalid_schedule'})`.
   */
  readonly scheduledPickupAt?: Date | null;
}

export class CreateRide {
  constructor(private readonly repo: RideRepository) {}

  async execute(
    input: CreateRideInput,
  ): Promise<Result<Ride, ConflictError | ValidationError>> {
    const id = this.repo.newId();
    // Branch at the factory level — scheduled rides need
    // `Ride.createScheduled` (which sets `status: 'scheduled'` and
    // `schedulePickupAt`); non-scheduled keeps the unchanged
    // `Ride.create` path.
    const rideR =
      input.scheduledPickupAt != null
        ? Ride.createScheduled({
            id,
            passenger: input.passenger,
            rideService: input.rideService,
            pickup: input.pickup,
            dropoff: input.dropoff,
            createdAt: input.createdAt,
            schedulePickupAt: input.scheduledPickupAt,
            ...(input.routePreference !== undefined
              ? { routePreference: input.routePreference }
              : {}),
          })
        : (() => {
            const args: {
              id: typeof id;
              passenger: PassengerSnapshot;
              rideService: RideServiceSnapshot;
              pickup: Endpoint;
              dropoff: Endpoint;
              createdAt: Date;
              routePreference?: RideRoutePreference | null;
            } = {
              id,
              passenger: input.passenger,
              rideService: input.rideService,
              pickup: input.pickup,
              dropoff: input.dropoff,
              createdAt: input.createdAt,
            };
            if (input.routePreference !== undefined) {
              args.routePreference = input.routePreference;
            }
            return Ride.create(args);
          })();
    if (!rideR.ok) return Result.err(rideR.error);
    return this.repo.create(rideR.value);
  }
}
