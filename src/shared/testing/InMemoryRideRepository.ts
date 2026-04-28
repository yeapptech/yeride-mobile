import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride, RideCancellation } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { TripPayment } from '@domain/entities/TripPayment';
import type { UserId } from '@domain/entities/UserId';
import {
  ConflictError,
  NotFoundError,
  type AuthorizationError,
  type NetworkError,
  type ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `RideRepository` for use-case unit tests + the dev fakes
 * branch in the DI container. Stores rides keyed by id, replays all writes
 * through observers + the available-rides subscription, and applies the
 * 50-mile Haversine cutoff client-side just like the legacy app.
 *
 * Test seams:
 *   - `seed(ride)` / `seedEvents(rideId, events)` / `seedPayments(rideId, payments)`:
 *     populate the store without going through the repository write path.
 *   - `mockCancelResult(...)` / `mockRequestPaymentResult(...)`:
 *     override the next call to those Cloud Function-shaped methods so a
 *     test can assert error paths.
 *   - `spies`: counts of every mutation method, plus the most recent args
 *     captured for each.
 */
export class InMemoryRideRepository implements RideRepository {
  private rides = new Map<string, Ride>();
  private events = new Map<string, TripEvent[]>();
  private payments = new Map<string, TripPayment[]>();

  private rideObservers = new Map<string, Set<(ride: Ride | null) => void>>();
  private availableObservers = new Set<{
    driverId: string;
    services: readonly RideServiceId[];
    location: Coordinates;
    radiusMeters: number;
    callback: (rides: readonly Ride[]) => void;
  }>();
  private eventObservers = new Map<
    string,
    Set<(events: readonly TripEvent[]) => void>
  >();
  private paymentObservers = new Map<
    string,
    Set<(payments: readonly TripPayment[]) => void>
  >();

  public spies = {
    create: 0,
    update: 0,
    requestPayment: 0,
    cancel: 0,
    lastCancelArgs: null as null | {
      rideId: RideId;
      by: 'rider' | 'driver';
      reason: CancellationReason;
      odometerMeters: number | undefined;
    },
  };

  private nextCancelResult: null | {
    type: 'error';
    error: NetworkError | NotFoundError | AuthorizationError | ValidationError;
  } = null;
  private nextRequestPaymentResult: null | {
    type: 'error';
    error: NetworkError | NotFoundError | AuthorizationError | ValidationError;
  } = null;

  /* ────────── RideRepository ────────── */

  newId(): RideId {
    // Firestore's auto-id is a 20-char alphanumeric. We mirror that shape so
    // tests built against `RideId.create()`'s validation regex pass without
    // surprises. `Math.random` is fine here — these ids never escape the
    // test process.
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < 20; i += 1) {
      value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const r = RideId.create(value);
    if (!r.ok) throw r.error;
    return r.value;
  }

  async create(
    ride: Ride,
  ): Promise<Result<Ride, ConflictError | ValidationError>> {
    this.spies.create += 1;
    const key = String(ride.id);
    if (this.rides.has(key)) {
      return Result.err(
        new ConflictError({
          code: 'ride_already_exists',
          message: `Ride ${key} already exists`,
        }),
      );
    }
    this.rides.set(key, ride);
    this.notifyRide(ride);
    this.notifyAvailable();
    return Result.ok(ride);
  }

  async getById(id: RideId): Promise<Result<Ride, NotFoundError>> {
    const found = this.rides.get(String(id));
    if (!found) {
      return Result.err(this.notFound(id));
    }
    return Result.ok(found);
  }

  observeById(id: RideId, callback: (ride: Ride | null) => void): () => void {
    const key = String(id);
    let set = this.rideObservers.get(key);
    if (!set) {
      set = new Set();
      this.rideObservers.set(key, set);
    }
    set.add(callback);
    // Emit the current value synchronously so subscribers reflect initial state.
    callback(this.rides.get(key) ?? null);
    return () => {
      set?.delete(callback);
    };
  }

  async update(
    ride: Ride,
  ): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    this.spies.update += 1;
    const key = String(ride.id);
    if (!this.rides.has(key)) {
      return Result.err(this.notFound(ride.id));
    }
    this.rides.set(key, ride);
    this.notifyRide(ride);
    this.notifyAvailable();
    return Result.ok(ride);
  }

  async listByPassenger(args: {
    passengerId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>> {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (r.passenger.id !== args.passengerId) continue;
      if (args.statuses && !args.statuses.includes(r.status)) continue;
      matching.push(r);
    }
    matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const sliced = args.limit ? matching.slice(0, args.limit) : matching;
    return Result.ok(sliced);
  }

  subscribeAvailableRides(args: {
    driverId: UserId;
    services: readonly RideServiceId[];
    driverLocation: Coordinates;
    radiusMeters?: number;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      driverId: String(args.driverId),
      services: args.services,
      location: args.driverLocation,
      radiusMeters: args.radiusMeters ?? DEFAULT_AVAILABLE_RADIUS_METERS,
      callback: args.callback,
    };
    this.availableObservers.add(entry);
    // Emit initial state.
    args.callback(this.computeAvailable(entry));
    return () => {
      this.availableObservers.delete(entry);
    };
  }

  subscribeEvents(args: {
    rideId: RideId;
    callback: (events: readonly TripEvent[]) => void;
  }): () => void {
    const key = String(args.rideId);
    let set = this.eventObservers.get(key);
    if (!set) {
      set = new Set();
      this.eventObservers.set(key, set);
    }
    set.add(args.callback);
    args.callback([...(this.events.get(key) ?? [])]);
    return () => {
      set?.delete(args.callback);
    };
  }

  subscribePayments(args: {
    rideId: RideId;
    callback: (payments: readonly TripPayment[]) => void;
  }): () => void {
    const key = String(args.rideId);
    let set = this.paymentObservers.get(key);
    if (!set) {
      set = new Set();
      this.paymentObservers.set(key, set);
    }
    set.add(args.callback);
    args.callback(this.sortedPayments(key));
    return () => {
      set?.delete(args.callback);
    };
  }

  async requestPayment(args: {
    rideId: RideId;
    odometerMeters: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    this.spies.requestPayment += 1;
    if (this.nextRequestPaymentResult?.type === 'error') {
      const e = this.nextRequestPaymentResult.error;
      this.nextRequestPaymentResult = null;
      return Result.err(e);
    }
    const ride = this.rides.get(String(args.rideId));
    if (!ride) return Result.err(this.notFound(args.rideId));
    const next = ride.requestPayment({
      odometerMeters: args.odometerMeters,
      at: new Date(),
    });
    if (!next.ok) return next;
    this.rides.set(String(args.rideId), next.value);
    this.notifyRide(next.value);
    return Result.ok(next.value);
  }

  async cancel(args: {
    rideId: RideId;
    by: 'rider' | 'driver';
    reason: CancellationReason;
    odometerMeters?: number;
  }): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    this.spies.cancel += 1;
    this.spies.lastCancelArgs = {
      rideId: args.rideId,
      by: args.by,
      reason: args.reason,
      odometerMeters: args.odometerMeters,
    };
    if (this.nextCancelResult?.type === 'error') {
      const e = this.nextCancelResult.error;
      this.nextCancelResult = null;
      return Result.err(e);
    }
    const ride = this.rides.get(String(args.rideId));
    if (!ride) return Result.err(this.notFound(args.rideId));
    const cancellation: RideCancellation = {
      reason: args.reason,
      by: args.by,
      at: new Date(),
      odometerMeters: args.odometerMeters ?? null,
    };
    const next = ride.cancel(cancellation);
    if (!next.ok) return next;
    this.rides.set(String(args.rideId), next.value);
    this.notifyRide(next.value);
    this.notifyAvailable();
    return Result.ok(next.value);
  }

  /* ────────── Test-only helpers ────────── */

  /** Seed a ride directly (bypassing the create write path). */
  seed(ride: Ride): void {
    this.rides.set(String(ride.id), ride);
  }

  seedEvents(rideId: RideId, events: readonly TripEvent[]): void {
    this.events.set(String(rideId), [...events]);
  }

  seedPayments(rideId: RideId, payments: readonly TripPayment[]): void {
    this.payments.set(String(rideId), [...payments]);
  }

  /** Make the next `cancel` call return the given error. */
  mockCancelResult(
    error: NetworkError | NotFoundError | AuthorizationError | ValidationError,
  ): void {
    this.nextCancelResult = { type: 'error', error };
  }

  /** Make the next `requestPayment` call return the given error. */
  mockRequestPaymentResult(
    error: NetworkError | NotFoundError | AuthorizationError | ValidationError,
  ): void {
    this.nextRequestPaymentResult = { type: 'error', error };
  }

  reset(): void {
    this.rides.clear();
    this.events.clear();
    this.payments.clear();
    this.rideObservers.clear();
    this.availableObservers.clear();
    this.eventObservers.clear();
    this.paymentObservers.clear();
    this.nextCancelResult = null;
    this.nextRequestPaymentResult = null;
    this.spies = {
      create: 0,
      update: 0,
      requestPayment: 0,
      cancel: 0,
      lastCancelArgs: null,
    };
  }

  /* ────────── private ────────── */

  private notFound(id: RideId): NotFoundError {
    return new NotFoundError({
      code: 'ride_not_found',
      message: `Ride ${String(id)} not found`,
      resource: 'ride',
      id: String(id),
    });
  }

  private notifyRide(ride: Ride): void {
    const set = this.rideObservers.get(String(ride.id));
    if (set) for (const o of set) o(ride);
  }

  private notifyAvailable(): void {
    for (const obs of this.availableObservers) {
      obs.callback(this.computeAvailable(obs));
    }
  }

  private computeAvailable(obs: {
    services: readonly RideServiceId[];
    location: Coordinates;
    radiusMeters: number;
  }): readonly Ride[] {
    const matching: Ride[] = [];
    const serviceSet = new Set(obs.services.map(String));
    for (const r of this.rides.values()) {
      if (r.status !== 'awaiting_driver' && r.status !== 'scheduled') continue;
      if (!serviceSet.has(String(r.rideService.id))) continue;
      const distance = obs.location.distanceTo(r.pickup.location);
      if (distance > obs.radiusMeters) continue;
      matching.push(r);
    }
    return matching;
  }

  private sortedPayments(key: string): TripPayment[] {
    return [...(this.payments.get(key) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
}

const DEFAULT_AVAILABLE_RADIUS_METERS = 80_467; // 50 mi (matches legacy)
