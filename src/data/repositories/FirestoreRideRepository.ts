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
  startAfter,
  where,
  type QueryConstraint,
} from '@react-native-firebase/firestore';

import type { CancellationReason } from '@domain/entities/CancellationReason';
import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideListCursor, type RidePage } from '@domain/entities/RideListCursor';
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
 * Decode a paginated-list cursor and return the ISO-string form for
 * Firestore `startAfter`. Legacy + the rewrite both write
 * `createdDateTime` as `new Date().toISOString()` (verified in
 * `yeride/src/api/firebase/Trip.js` line 541 and `rideMapper.toDoc`),
 * so comparing against an ISO string is lexicographically equivalent
 * to chronological order on the indexed field.
 *
 * Returns `null` when no cursor was provided (caller treats as
 * "first page").
 */
function cursorToIsoString(cursor: RideListCursor): Result<string, Error> {
  const decoded = RideListCursor.decode(cursor);
  if (!decoded.ok) return Result.err(decoded.error);
  return Result.ok(new Date(decoded.value.createdAtMillis).toISOString());
}

/**
 * Build a `RideListCursor` from the boundary doc's `createdDateTime`
 * raw value (string or Firestore Timestamp) + doc id. Returns `null`
 * if the boundary value can't be coerced to a millis timestamp — the
 * caller then surfaces `nextCursor: null` (end-of-list). The "Timestamp
 * object with toMillis()" branch is defensive — legacy yeride writes
 * ISO strings exclusively, but Cloud Functions or backfills could
 * surface a Timestamp.
 */
function buildCursor(
  rawCreatedDateTime: unknown,
  lastDocId: string,
): RideListCursor | null {
  const millis = (() => {
    if (typeof rawCreatedDateTime === 'string') {
      const ms = Date.parse(rawCreatedDateTime);
      return Number.isFinite(ms) ? ms : null;
    }
    if (
      rawCreatedDateTime !== null &&
      typeof rawCreatedDateTime === 'object' &&
      'toMillis' in rawCreatedDateTime &&
      typeof (rawCreatedDateTime as { toMillis: unknown }).toMillis ===
        'function'
    ) {
      try {
        const ms = (
          rawCreatedDateTime as { toMillis: () => number }
        ).toMillis();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    }
    return null;
  })();
  if (millis === null) return null;
  const r = RideListCursor.create({
    createdAtMillis: millis,
    docId: lastDocId,
  });
  return r.ok ? r.value : null;
}

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
        // stays warn — Firestore SDK stream error (network outage,
        // permission flip mid-stream). Wrapped in the synthetic
        // `callback(null)` so the caller observes a graceful
        // disconnection. The user-facing failure surfaces via the use
        // case returning empty / not-found; flipping here would
        // double-report alongside that. Audit decision per Phase 9
        // turn 11 (skip Firestore SDK-catch wrappers).
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
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>> {
    try {
      const cursorIsoR = args.cursor
        ? cursorToIsoString(args.cursor)
        : Result.ok(null);
      if (!cursorIsoR.ok) {
        return Result.err(
          new NetworkError({
            code: 'ride_list_cursor_malformed',
            message: 'RideListCursor could not be decoded',
            cause: cursorIsoR.error,
          }),
        );
      }
      const clauses: QueryConstraint[] = [
        where('passenger.id', '==', String(args.passengerId)),
        orderBy('createdDateTime', 'desc'),
      ];
      if (cursorIsoR.value !== null) {
        clauses.push(startAfter(cursorIsoR.value));
      }
      if (args.limit) {
        clauses.push(fsLimit(args.limit));
      }
      const q = query(collection(this.firestore, TRIPS), ...clauses);
      const snap = await getDocs(q);
      return Result.ok(this.buildPage(snap, args.statuses, args.limit));
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
    cursor?: RideListCursor;
  }): Promise<Result<RidePage, NetworkError>> {
    try {
      // Mirrors listByPassenger: equality on `driver.id`, server-side
      // ordering by createdDateTime desc. Optional status filter applied
      // client-side to avoid a composite index requirement (legacy did
      // the same — keeps the rewrite query-pattern-compatible).
      const cursorIsoR = args.cursor
        ? cursorToIsoString(args.cursor)
        : Result.ok(null);
      if (!cursorIsoR.ok) {
        return Result.err(
          new NetworkError({
            code: 'ride_list_cursor_malformed',
            message: 'RideListCursor could not be decoded',
            cause: cursorIsoR.error,
          }),
        );
      }
      const clauses: QueryConstraint[] = [
        where('driver.id', '==', String(args.driverId)),
        orderBy('createdDateTime', 'desc'),
      ];
      if (cursorIsoR.value !== null) {
        clauses.push(startAfter(cursorIsoR.value));
      }
      if (args.limit) {
        clauses.push(fsLimit(args.limit));
      }
      const q = query(collection(this.firestore, TRIPS), ...clauses);
      const snap = await getDocs(q);
      return Result.ok(this.buildPage(snap, args.statuses, args.limit));
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

  /**
   * Convert a Firestore query snapshot into a RidePage. Applies the
   * optional client-side status filter, then computes `nextCursor` from
   * the last raw doc (BEFORE the status filter, so the cursor advances
   * correctly even when the status filter shrinks the visible page —
   * matches the legacy "client-side filter may shrink a page below the
   * requested limit" pattern; the caller's `useInfiniteQuery` issues
   * follow-up pages if it cares about a strict count).
   */
  private buildPage(
    // typed loosely so we don't drag the modular SDK QuerySnapshot type
    // through every method signature; the only operations we need are
    // `size`, iteration, and `id` / `data()` on each doc.
    snap: {
      size: number;
      forEach: (cb: (d: { id: string; data: () => unknown }) => void) => void;
    },
    statuses: readonly RideStatus[] | undefined,
    limit: number | undefined,
  ): RidePage {
    const out: Ride[] = [];
    let lastId: string | null = null;
    let lastCreatedDateTime: unknown = null;
    snap.forEach((d) => {
      // Track the BOUNDARY doc regardless of status-filter outcome —
      // see method docstring for why.
      lastId = d.id;
      const data = d.data();
      if (data && typeof data === 'object' && 'createdDateTime' in data) {
        lastCreatedDateTime = (data as { createdDateTime: unknown })
          .createdDateTime;
      }
      const r = this.toDomainOrCorrupt(d.id, data);
      if (!r.ok) return;
      if (statuses && !statuses.includes(r.value.status)) return;
      out.push(r.value);
    });
    const nextCursor =
      limit !== undefined && snap.size === limit && lastId !== null
        ? buildCursor(lastCreatedDateTime, lastId)
        : null;
    return { rides: out, nextCursor };
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

  observeScheduledRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    // No `orderBy` clause — keeps the cutover-plan §3.4 "Firestore
    // indexes unchanged from legacy app's HEAD" gate green. Callers
    // sort by `schedulePickupAt asc` client-side. A composite
    // `(passenger.id, status, schedulePickupAt)` index would be the
    // future-proofing if scheduled-ride volume per rider grew, but
    // typical rider has < 5 pending scheduled rides — Sort cost is
    // negligible.
    const q = query(
      collection(this.firestore, TRIPS),
      where('passenger.id', '==', String(args.passengerId)),
      where('status', 'in', ['scheduled', 'scheduled_driver_accepted']),
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: Ride[] = [];
        snap.forEach((d) => {
          const r = this.toDomainOrCorrupt(d.id, d.data());
          if (!r.ok) return;
          out.push(r.value);
        });
        args.callback(out);
      },
      (e) => {
        // Stays warn — Firestore SDK stream error (network outage,
        // permission flip mid-stream). Matches the
        // `subscribeAvailableRides` / `observeById` pattern: deliver an
        // empty list so the caller observes a graceful disconnection
        // rather than double-reporting against a NetworkError surface.
        logger.warn('observeScheduledRidesByPassenger error', {
          passengerId: String(args.passengerId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }

  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const q = query(
      collection(this.firestore, TRIPS),
      where('passenger.id', '==', String(args.passengerId)),
      where('status', 'in', [
        'awaiting_driver',
        'dispatched',
        'started',
        'payment_requested',
        'payment_failed',
      ]),
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: Ride[] = [];
        snap.forEach((d) => {
          const r = this.toDomainOrCorrupt(d.id, d.data());
          if (!r.ok) return;
          out.push(r.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('observeInProgressRidesByPassenger error', {
          passengerId: String(args.passengerId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }

  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const q = query(
      collection(this.firestore, TRIPS),
      where('driver.id', '==', String(args.driverId)),
      where('status', 'in', [
        'dispatched',
        'started',
        'payment_requested',
        'payment_failed',
      ]),
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: Ride[] = [];
        snap.forEach((d) => {
          const r = this.toDomainOrCorrupt(d.id, d.data());
          if (!r.ok) return;
          out.push(r.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('observeInProgressRidesByDriver error', {
          driverId: String(args.driverId),
          code: errCode(e),
        });
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
      // Surface which field(s) failed so we can debug doc-shape drift
      // without round-tripping through Firestore Console. Path + code
      // are PII-safe; we deliberately omit zod's `message` (which can
      // echo the offending value for some validators).
      const issues = extractZodIssues(parsed.error.cause);
      const topLevelKeys =
        raw !== null && typeof raw === 'object'
          ? Object.keys(raw as Record<string, unknown>).sort()
          : [];
      // Phase 9 turn 11 — flipped from warn to error. Per-doc schema
      // validation failure on the rides stream. Constructed Error
      // with stable `ride_doc_invalid_schema` prefix for Crashlytics
      // grouping; the `parsed.error` (a `ValidationError` wrapping
      // the zod ZodError as `cause`) goes in the `error` meta field
      // so `extractError` resolves it via the rawMeta channel. The
      // `issues` and `topLevelKeys` debug context lands in the
      // breadcrumb (sanitizer leaves these alone). Audit decision
      // per Phase 9 turn 11 pre-checklist Q2.
      logger.error('ride doc failed schema validation', {
        id,
        issues,
        topLevelKeys,
        error: new Error('ride_doc_invalid_schema'),
      });
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
      // Phase 9 turn 11 — flipped from warn to error. Per-doc entity
      // construction failure (DTO passed zod but failed value-object
      // semantic validation). Stable `ride_doc_invalid_entity` prefix;
      // domain.error.code (e.g. `'coordinates_lat_out_of_range'`)
      // suffixes for grouping granularity.
      logger.error('ride doc failed entity construction', {
        id,
        error: new Error(`ride_doc_invalid_entity: ${domain.error.code}`),
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

/**
 * Extract `{path, code}` entries from a zod error stored in
 * `ValidationError.cause`. Path + code are diagnostic-safe (no values),
 * so they're fine to log even though raw doc values would be PII.
 *
 * Defensive: not every cause is a zod error, and zod's API has shifted
 * over majors — we duck-type against `.issues` and handle missing
 * fields gracefully instead of throwing inside a logger call.
 */
function extractZodIssues(
  cause: unknown,
): readonly { path: string; code: string }[] {
  if (cause === null || typeof cause !== 'object') return [];
  const maybeIssues = (cause as { issues?: unknown }).issues;
  if (!Array.isArray(maybeIssues)) return [];
  return maybeIssues.slice(0, 10).map((issue: unknown) => {
    const i = issue as { path?: unknown; code?: unknown };
    const path = Array.isArray(i.path) ? i.path.join('.') : '<unknown>';
    const code = typeof i.code === 'string' ? i.code : '<unknown>';
    return { path, code };
  });
}
