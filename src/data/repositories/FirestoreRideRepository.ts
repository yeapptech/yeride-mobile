import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from '@react-native-firebase/firestore';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { RideStatus } from '@domain/entities/RideStatus';
import type { TripEvent } from '@domain/entities/TripEvent';
import type { TripPayment } from '@domain/entities/TripPayment';
import type { UserId } from '@domain/entities/UserId';
import type { ValidationError } from '@domain/errors';
import {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import * as rideMapper from '../mappers/rideMapper';
import * as tripEventMapper from '../mappers/tripEventMapper';
import * as tripPaymentMapper from '../mappers/tripPaymentMapper';
import { CloudFunctionsService } from '../services/CloudFunctionsService';

const logger = LOG.extend('FirestoreRide');

const TRIPS = 'trips';
const EVENTS = 'events';
const PAYMENTS = 'payments';

const DEFAULT_AVAILABLE_RADIUS_METERS = 80_467; // 50 mi (legacy)

/**
 * Concrete `RideRepository` backed by `@react-native-firebase/firestore` +
 * the `CloudFunctionsService` adapter.
 *
 *   - `create` / `update` / `getById` / `observeById` /
 *     `subscribeAvailableRides` / `subscribeEvents` / `subscribePayments`
 *     are direct Firestore calls.
 *   - `requestPayment` and `cancel` route through Cloud Function callables
 *     (server-side fare math + auth checks).
 *
 * Subscription methods return synchronous unsubscribe functions to satisfy
 * React's effect-cleanup contract.
 *
 * Firestore quirks worth knowing:
 *   - `where(field, 'in', [...])` is limited to ONE per query in legacy
 *     Firestore; modern combines them but with caveats. We do
 *     `where('status', 'in', [active])` server-side and filter
 *     `rideService.id` + Haversine distance client-side. Matches legacy.
 *   - The trips collection is read-public-but-filtered-by-rules (drivers
 *     can read awaiting/scheduled trips for browsing). Auth is enforced
 *     server-side by Firestore rules; the client just reads what's allowed.
 *
 * Per-doc validation failures are logged + skipped on bulk reads
 * (subscribeAvailableRides, listByPassenger) so a single corrupt trip
 * doesn't break the whole list.
 */
export class FirestoreRideRepository implements RideRepository {
  private readonly firestore = getFirestore();
  private readonly cloudFunctions = new CloudFunctionsService();

  newId(): RideId {
    // Firestore's auto-id is a 20-char alphanumeric string; `doc(collection)`
    // without args generates one without writing. `RideId.create` accepts
    // anything Firestore-doc-safe, so this is always valid.
    const ref = doc(collection(this.firestore, TRIPS));
    const r = RideId.create(ref.id);
    if (!r.ok) throw r.error;
    return r.value;
  }

  async create(
    ride: Ride,
  ): Promise<Result<Ride, ConflictError | ValidationError>> {
    const ref = doc(this.firestore, TRIPS, String(ride.id));
    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        return Result.err(
          new ConflictError({
            code: 'ride_already_exists',
            message: `Ride ${String(ride.id)} already exists`,
          }),
        );
      }
      await setDoc(ref, rideMapper.toDoc(ride));
      return Result.ok(ride);
    } catch (e) {
      logger.error('create failed', e);
      throw e;
    }
  }

  async getById(id: RideId): Promise<Result<Ride, NotFoundError>> {
    const ref = doc(this.firestore, TRIPS, String(id));
    const snap = await getDoc(ref);
    const raw = snap.data();
    if (!raw) {
      return Result.err(this.notFound(id));
    }
    return this.toDomainOrCorrupt(String(id), raw);
  }

  observeById(id: RideId, callback: (ride: Ride | null) => void): () => void {
    const ref = doc(this.firestore, TRIPS, String(id));
    return onSnapshot(
      ref,
      (snap) => {
        const raw = snap.data();
        if (!raw) {
          callback(null);
          return;
        }
        const r = this.toDomainOrCorrupt(String(id), raw);
        callback(r.ok ? r.value : null);
      },
      (e) => {
        logger.warn('observeById error', { id: String(id), code: errCode(e) });
        callback(null);
      },
    );
  }

  async update(
    ride: Ride,
  ): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const ref = doc(this.firestore, TRIPS, String(ride.id));
    try {
      // Use setDoc with merge so any fields the rewrite doesn't track yet
      // (e.g. lastSeenByRiderAt) are preserved on the doc.
      await setDoc(ref, rideMapper.toDoc(ride), { merge: true });
      return Result.ok(ride);
    } catch (e) {
      logger.error('update failed', e);
      const code = errCode(e);
      if (code === 'permission-denied') {
        return Result.err(
          new AuthorizationError({
            code: 'ride_update_forbidden',
            message: 'Not allowed to update this ride',
            cause: e,
          }),
        );
      }
      throw e;
    }
  }

  async listByPassenger(args: {
    passengerId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>> {
    try {
      const baseQ = query(
        collection(this.firestore, TRIPS),
        where('passenger.id', '==', String(args.passengerId)),
        orderBy('createdDateTime', 'desc'),
      );
      const q = args.limit ? query(baseQ, fsLimit(args.limit)) : baseQ;
      const snap = await getDocs(q);
      const out: Ride[] = [];
      snap.forEach((d) => {
        const r = this.toDomainOrCorrupt(d.id, d.data());
        if (!r.ok) return;
        // Apply the optional status filter client-side. Firestore can't
        // combine `passenger.id ==` + `status in` in one query without a
        // composite index, and statuses is a client-defined slice anyway.
        if (args.statuses && !args.statuses.includes(r.value.status)) return;
        out.push(r.value);
      });
      return Result.ok(out);
    } catch (e) {
      logger.warn('listByPassenger failed', { code: errCode(e) });
      return Result.err(
        new NetworkError({
          code: 'ride_list_failed',
          message: 'Could not load passenger trips',
          cause: e,
        }),
      );
    }
  }

  async listByDriver(args: {
    driverId: UserId;
    statuses?: readonly RideStatus[];
    limit?: number;
  }): Promise<Result<readonly Ride[], NetworkError>> {
    try {
      // Mirrors listByPassenger: equality on `driver.id`, server-side
      // ordering by createdDateTime desc. Optional status filter applied
      // client-side to avoid a composite index requirement (legacy did
      // the same — keeps the rewrite query-pattern-compatible).
      const baseQ = query(
        collection(this.firestore, TRIPS),
        where('driver.id', '==', String(args.driverId)),
        orderBy('createdDateTime', 'desc'),
      );
      const q = args.limit ? query(baseQ, fsLimit(args.limit)) : baseQ;
      const snap = await getDocs(q);
      const out: Ride[] = [];
      snap.forEach((d) => {
        const r = this.toDomainOrCorrupt(d.id, d.data());
        if (!r.ok) return;
        if (args.statuses && !args.statuses.includes(r.value.status)) return;
        out.push(r.value);
      });
      return Result.ok(out);
    } catch (e) {
      logger.warn('listByDriver failed', { code: errCode(e) });
      return Result.err(
        new NetworkError({
          code: 'ride_list_failed',
          message: 'Could not load driver trips',
          cause: e,
        }),
      );
    }
  }

  subscribeAvailableRides(args: {
    driverId: UserId;
    services: readonly RideServiceId[];
    driverLocation: Coordinates;
    radiusMeters?: number;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const radius = args.radiusMeters ?? DEFAULT_AVAILABLE_RADIUS_METERS;
    const serviceSet = new Set(args.services.map(String));
    const q = query(
      collection(this.firestore, TRIPS),
      where('status', 'in', ['awaiting_driver', 'scheduled']),
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: Ride[] = [];
        snap.forEach((d) => {
          const r = this.toDomainOrCorrupt(d.id, d.data());
          if (!r.ok) return;
          if (!serviceSet.has(String(r.value.rideService.id))) return;
          const distance = args.driverLocation.distanceTo(
            r.value.pickup.location,
          );
          if (distance > radius) return;
          out.push(r.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('subscribeAvailableRides error', { code: errCode(e) });
        args.callback([]);
      },
    );
  }

  subscribeEvents(args: {
    rideId: RideId;
    callback: (events: readonly TripEvent[]) => void;
  }): () => void {
    const subcoll = collection(
      this.firestore,
      TRIPS,
      String(args.rideId),
      EVENTS,
    );
    const q = query(subcoll, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        const out: TripEvent[] = [];
        snap.forEach((d) => {
          const parsed = tripEventMapper.parseTripEventDoc(d.data());
          if (!parsed.ok) return;
          const domain = tripEventMapper.toDomain(d.id, parsed.value);
          if (!domain.ok) return;
          out.push(domain.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('subscribeEvents error', { code: errCode(e) });
        args.callback([]);
      },
    );
  }

  subscribePayments(args: {
    rideId: RideId;
    callback: (payments: readonly TripPayment[]) => void;
  }): () => void {
    const subcoll = collection(
      this.firestore,
      TRIPS,
      String(args.rideId),
      PAYMENTS,
    );
    const q = query(subcoll, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const out: TripPayment[] = [];
        snap.forEach((d) => {
          const parsed = tripPaymentMapper.parseTripPaymentDoc(d.data());
          if (!parsed.ok) return;
          const domain = tripPaymentMapper.toDomain(d.id, parsed.value);
          if (!domain.ok) return;
          out.push(domain.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('subscribePayments error', { code: errCode(e) });
        args.callback([]);
      },
    );
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
    const fnResult = await this.cloudFunctions.completeTrip({
      tripId: String(args.rideId),
      odometerMeters: args.odometerMeters,
    });
    if (!fnResult.ok) return fnResult;
    // The function wrote `payment_requested` + the final fare to the trip
    // doc. Re-fetch so the caller sees the canonical updated state.
    return this.refetch(args.rideId);
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
    const fnResult = await this.cloudFunctions.cancelTrip({
      tripId: String(args.rideId),
      by: args.by,
      code: args.reason.code,
      reasonText: args.reason.reasonText,
      odometerMeters: args.odometerMeters ?? null,
    });
    if (!fnResult.ok) return fnResult;
    return this.refetch(args.rideId);
  }

  /* ────────── private ────────── */

  private async refetch(
    id: RideId,
  ): Promise<
    Result<
      Ride,
      NetworkError | NotFoundError | AuthorizationError | ValidationError
    >
  > {
    const r = await this.getById(id);
    if (!r.ok) return r;
    return Result.ok(r.value);
  }

  private notFound(id: RideId): NotFoundError {
    return new NotFoundError({
      code: 'ride_not_found',
      message: `Ride ${String(id)} not found`,
      resource: 'ride',
      id: String(id),
    });
  }

  private toDomainOrCorrupt(
    id: string,
    raw: unknown,
  ): Result<Ride, NotFoundError> {
    const parsed = rideMapper.parseRideDoc(raw);
    if (!parsed.ok) {
      logger.warn('ride doc failed schema validation', { id });
      return Result.err(
        new NotFoundError({
          code: 'ride_corrupt',
          message: `Ride ${id} exists but failed schema validation`,
          resource: 'ride',
          id,
          cause: parsed.error,
        }),
      );
    }
    const domain = rideMapper.toDomain(id, parsed.value);
    if (!domain.ok) {
      logger.warn('ride doc failed entity construction', {
        id,
        code: domain.error.code,
      });
      return Result.err(
        new NotFoundError({
          code: 'ride_corrupt',
          message: `Ride ${id} could not be constructed`,
          resource: 'ride',
          id,
          cause: domain.error,
        }),
      );
    }
    return Result.ok(domain.value);
  }
}

function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return String((e as { code: unknown }).code);
  }
  return 'unknown';
}
