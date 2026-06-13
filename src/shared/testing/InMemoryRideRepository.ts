import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride, RideCancellation } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideListCursor, type RidePage } from '@domain/entities/RideListCursor';
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
  private scheduledObservers = new Set<{
    passengerId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
  private scheduledDriverObservers = new Set<{
    driverId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
  private inProgressPassengerObservers = new Set<{
    passengerId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
  private inProgressDriverObservers = new Set<{
    driverId: string;
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
    this.notifyScheduled();
    this.notifyInProgress();
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
    this.notifyScheduled();
    this.notifyInProgress();
    return Result.ok(ride);
  }

  async listByPassenger(args: {
    passengerId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>> {
    const allMatching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (r.passenger.id !== args.passengerId) continue;
      allMatching.push(r);
    }
    allMatching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Result.ok(
      paginateInMemory(allMatching, args.statuses, args.limit, args.cursor),
    );
  }

  async listByDriver(args: {
    driverId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>> {
    const allMatching: Ride[] = [];
    for (const r of this.rides.values()) {
      // Rides with no driver yet (awaiting_driver) are excluded — this is
      // "rides this driver has accepted", not "rides this driver could
      // accept" (which is `subscribeAvailableRides`).
      if (!r.driver || r.driver.id !== args.driverId) continue;
      allMatching.push(r);
    }
    allMatching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Result.ok(
      paginateInMemory(allMatching, args.statuses, args.limit, args.cursor),
    );
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

  observeScheduledRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      passengerId: String(args.passengerId),
      callback: args.callback,
    };
    this.scheduledObservers.add(entry);
    // Emit current state synchronously so subscribers reflect initial
    // contents the same way the Firestore `onSnapshot` does on attach.
    args.callback(this.computeScheduled(entry.passengerId));
    return () => {
      this.scheduledObservers.delete(entry);
    };
  }

  observeScheduledRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      driverId: String(args.driverId),
      callback: args.callback,
    };
    this.scheduledDriverObservers.add(entry);
    args.callback(this.computeScheduledByDriver(entry.driverId));
    return () => {
      this.scheduledDriverObservers.delete(entry);
    };
  }

  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      passengerId: String(args.passengerId),
      callback: args.callback,
    };
    this.inProgressPassengerObservers.add(entry);
    // Emit current state synchronously so subscribers reflect initial
    // contents the same way the Firestore `onSnapshot` does on attach.
    args.callback(this.computeInProgressByPassenger(entry.passengerId));
    return () => {
      this.inProgressPassengerObservers.delete(entry);
    };
  }

  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      driverId: String(args.driverId),
      callback: args.callback,
    };
    this.inProgressDriverObservers.add(entry);
    // Emit current state synchronously so subscribers reflect initial
    // contents the same way the Firestore `onSnapshot` does on attach.
    args.callback(this.computeInProgressByDriver(entry.driverId));
    return () => {
      this.inProgressDriverObservers.delete(entry);
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
    this.notifyScheduled();
    this.notifyInProgress();
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
    this.notifyScheduled();
    this.notifyInProgress();
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
    this.scheduledObservers.clear();
    this.inProgressPassengerObservers.clear();
    this.inProgressDriverObservers.clear();
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

  private notifyScheduled(): void {
    for (const obs of this.scheduledObservers) {
      obs.callback(this.computeScheduled(obs.passengerId));
    }
    for (const obs of this.scheduledDriverObservers) {
      obs.callback(this.computeScheduledByDriver(obs.driverId));
    }
  }

  private computeScheduled(passengerId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (String(r.passenger.id) !== passengerId) continue;
      if (
        r.status !== 'scheduled' &&
        r.status !== 'scheduled_driver_accepted'
      ) {
        continue;
      }
      matching.push(r);
    }
    return matching;
  }

  private computeScheduledByDriver(driverId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (!r.driver || String(r.driver.id) !== driverId) continue;
      if (r.status !== 'scheduled_driver_accepted') continue;
      matching.push(r);
    }
    return matching;
  }

  private notifyInProgress(): void {
    for (const obs of this.inProgressPassengerObservers) {
      obs.callback(this.computeInProgressByPassenger(obs.passengerId));
    }
    for (const obs of this.inProgressDriverObservers) {
      obs.callback(this.computeInProgressByDriver(obs.driverId));
    }
  }

  private computeInProgressByPassenger(passengerId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (String(r.passenger.id) !== passengerId) continue;
      if (!RIDER_LIVE_STATUSES.has(r.status)) continue;
      matching.push(r);
    }
    return matching;
  }

  private computeInProgressByDriver(driverId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (!r.driver || String(r.driver.id) !== driverId) continue;
      if (!DRIVER_LIVE_STATUSES.has(r.status)) continue;
      matching.push(r);
    }
    return matching;
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

const RIDER_LIVE_STATUSES: ReadonlySet<RideStatus> = new Set([
  'awaiting_driver',
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
]);

const DRIVER_LIVE_STATUSES: ReadonlySet<RideStatus> = new Set([
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
]);

/**
 * Reproduce the Firestore pagination shape (`{ rides, nextCursor }`)
 * over an already-sorted-desc-by-createdAt list of candidate rides.
 *
 * Mirrors the Firestore adapter:
 *   1. Apply the cursor by SKIPPING every ride whose `createdAt >=
 *      cursorMillis`. This matches the real adapter's single-field
 *      `startAfter(<iso>)` semantics — Firestore drops the boundary
 *      row AND any tie-mates that share its `createdDateTime`. The
 *      `docId` segment of the cursor is intentionally ignored here
 *      so the fake doesn't mask the real adapter's tie-skip behavior.
 *      (See `RideListCursor`'s file-level docstring for the rationale
 *      — per-user ties are functionally impossible in production.)
 *   2. Slice to `limit` raw rows.
 *   3. Track the boundary doc id BEFORE applying the status filter, so
 *      `nextCursor` advances by the raw last row (matches the Firestore
 *      adapter's `buildPage` invariant).
 *   4. Apply the optional status filter client-side.
 *   5. Emit `nextCursor: null` when the raw page is shorter than
 *      `limit` (end-of-list) or when no `limit` was given.
 */
function paginateInMemory(
  sortedDesc: readonly Ride[],
  statuses: readonly RideStatus[] | undefined,
  limit: number | undefined,
  cursor: RideListCursor | undefined,
): RidePage {
  let startIndex = 0;
  if (cursor) {
    const decoded = RideListCursor.decode(cursor);
    if (decoded.ok) {
      const { createdAtMillis } = decoded.value;
      // Single-field tie-skip: drop every row whose createdAt >= the
      // cursor's millis. Since the list is sorted desc by createdAt,
      // that's equivalent to "advance to the first row strictly less
      // than the cursor". `findIndex` returns -1 when no such row
      // exists — interpret that as "end of list".
      const i = sortedDesc.findIndex(
        (r) => r.createdAt.getTime() < createdAtMillis,
      );
      startIndex = i >= 0 ? i : sortedDesc.length;
    }
  }

  const rawSlice =
    limit !== undefined
      ? sortedDesc.slice(startIndex, startIndex + limit)
      : sortedDesc.slice(startIndex);

  const boundary = rawSlice.length > 0 ? rawSlice[rawSlice.length - 1] : null;
  const filtered = statuses
    ? rawSlice.filter((r) => statuses.includes(r.status))
    : rawSlice;

  const nextCursor =
    limit !== undefined && rawSlice.length === limit && boundary
      ? (() => {
          const c = RideListCursor.create({
            createdAtMillis: boundary.createdAt.getTime(),
            docId: String(boundary.id),
          });
          return c.ok ? c.value : null;
        })()
      : null;

  return { rides: filtered, nextCursor };
}
