import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { UserLocation, type TripTracking } from '@domain/entities/UserLocation';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  UserLocationDocSchema,
  type TripTrackingDoc,
  type UserLocationDoc,
} from '../dto/UserLocationDoc';

/**
 * Bidirectional mapper between Firestore `locations/{userId}` docs and
 * the domain `UserLocation` value object.
 *
 * Bidirectional because the client owns the location pipeline — every
 * GPS update writes here. Read-side: the rider's UI subscribes to the
 * driver's location for live tracking.
 */

export function parseUserLocationDoc(
  raw: unknown,
): Result<UserLocationDoc, ValidationError> {
  const r = UserLocationDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'user_location_doc_invalid_shape',
        message: `UserLocationDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  userId: string,
  doc: UserLocationDoc,
): Result<UserLocation, ValidationError> {
  const userIdR = UserId.create(userId);
  if (!userIdR.ok) return userIdR;
  const locR = Coordinates.create(doc.latitude, doc.longitude);
  if (!locR.ok) return locR;
  const updatedAt = new Date(doc.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    return Result.err(
      new ValidationError({
        code: 'user_location_invalid_updated_at',
        message: 'updatedAt must parse to a valid Date',
        field: 'updatedAt',
      }),
    );
  }

  let tripTracking: TripTracking | null = null;
  if (doc.tripTracking) {
    const ttR = tripTrackingToDomain(doc.tripTracking);
    if (!ttR.ok) return ttR;
    tripTracking = ttR.value;
  }

  return UserLocation.create({
    userId: userIdR.value,
    location: locR.value,
    speed: doc.speed ?? null,
    updatedAt,
    tripTracking,
  });
}

function tripTrackingToDomain(
  d: TripTrackingDoc,
): Result<TripTracking, ValidationError> {
  const tripIdR = RideId.create(d.tripId);
  if (!tripIdR.ok) return tripIdR;
  const destLocR = Coordinates.create(
    d.destination.latitude,
    d.destination.longitude,
  );
  if (!destLocR.ok) return destLocR;

  // Phase 10 turn 5 — translate the live-ETA telemetry fields. The DTO
  // already preprocessed the legacy `{distance, duration, calculatedAt}`
  // shape into the canonical flat fields, so we only read the flat side
  // here. `null` and `undefined` both collapse to `null` at the domain
  // boundary (the entity's optional field uses null sentinel).
  const distanceMeters =
    d.distanceMeters === undefined || d.distanceMeters === null
      ? null
      : d.distanceMeters;
  const durationSeconds =
    d.durationSeconds === undefined || d.durationSeconds === null
      ? null
      : d.durationSeconds;
  const updatedAt =
    d.updatedAtMs === undefined || d.updatedAtMs === null
      ? null
      : new Date(d.updatedAtMs);

  return Result.ok({
    tripId: tripIdR.value,
    tripStatus: d.tripStatus,
    destination: {
      type: d.destination.type,
      location: destLocR.value,
    },
    distanceMeters,
    durationSeconds,
    updatedAt,
  });
}

/**
 * Doc shape that the rewrite EMITS on write. Strictly a superset of the
 * Zod-validated `UserLocationDoc` schema — the schema only validates the
 * canonical flat tripTracking fields, but the write side ALSO emits the
 * legacy nested shape (`distance: {value, text}, duration: {value,
 * text}, calculatedAt`) so legacy yeride clients keep reading ETA
 * during the cutover window. This type captures the broader shape so
 * the function signature stays honest.
 */
type LegacyTripTrackingExtras = {
  readonly distance?: { readonly value: number; readonly text: string };
  readonly duration?: { readonly value: number; readonly text: string };
  readonly calculatedAt?: string;
};

type EmittedTripTrackingDoc = TripTrackingDoc & LegacyTripTrackingExtras;

export type EmittedUserLocationDoc = Omit<UserLocationDoc, 'tripTracking'> & {
  readonly tripTracking?: EmittedTripTrackingDoc | null;
};

export function toDoc(loc: UserLocation): EmittedUserLocationDoc {
  return {
    latitude: loc.location.latitude,
    longitude: loc.location.longitude,
    speed: loc.speed,
    updatedAt: loc.updatedAt.toISOString(),
    ...(loc.tripTracking
      ? { tripTracking: tripTrackingToDoc(loc.tripTracking) }
      : {}),
  };
}

function tripTrackingToDoc(t: TripTracking): EmittedTripTrackingDoc {
  // Phase 10 turn 5 — dual-write. The canonical flat fields
  // (`distanceMeters`, `durationSeconds`, `updatedAtMs`) are what the
  // rewrite's mapper reads back; the nested `{distance, duration,
  // calculatedAt}` shape is what legacy yeride's `TripETAInfo` reads.
  // Both must be on the doc until legacy is retired (Phase 10).
  //
  // Floats are rounded to integers — the SDK exposes integer
  // meters/seconds anyway, and Math.round here keeps CI happy if a
  // future caller passes a float through.
  const baseDoc: TripTrackingDoc = {
    tripId: String(t.tripId),
    tripStatus: t.tripStatus,
    destination: {
      type: t.destination.type,
      latitude: t.destination.location.latitude,
      longitude: t.destination.location.longitude,
    },
    ...(t.distanceMeters !== null
      ? { distanceMeters: Math.round(t.distanceMeters) }
      : {}),
    ...(t.durationSeconds !== null
      ? { durationSeconds: Math.round(t.durationSeconds) }
      : {}),
    ...(t.updatedAt !== null ? { updatedAtMs: t.updatedAt.getTime() } : {}),
  };

  // Legacy parity. Only emit nested shape when we have telemetry —
  // pre-first-callback writes look the same on the wire as legacy
  // "tripTracking has no distance/duration yet" docs.
  const legacy: LegacyTripTrackingExtras = {};
  if (t.distanceMeters !== null) {
    const meters = Math.round(t.distanceMeters);
    Object.assign(legacy, {
      distance: { value: meters, text: formatMetersToText(meters) },
    });
  }
  if (t.durationSeconds !== null) {
    const seconds = Math.round(t.durationSeconds);
    Object.assign(legacy, {
      duration: { value: seconds, text: formatSecondsToText(seconds) },
    });
  }
  if (t.updatedAt !== null) {
    Object.assign(legacy, { calculatedAt: t.updatedAt.toISOString() });
  }

  return { ...baseDoc, ...legacy };
}

/**
 * Phase 10 turn 5 — match the legacy `formatMetersToText` from
 * `yeride/src/api/services/distanceTrackingService.js` so the legacy
 * client renders identical-looking text after a rewrite-side write.
 * Sub-mile → "Xft" (rounded to whole feet), 1 mi+ → "X.Y mi" (one
 * decimal).
 */
function formatMetersToText(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) {
    const feet = Math.round(meters * 3.28084);
    return `${String(feet)} ft`;
  }
  return `${miles.toFixed(1)} mi`;
}

/**
 * Phase 10 turn 5 — match the legacy `formatSecondsToText` so the
 * legacy client's `TripETAInfo` renders identical strings.
 * < 60s  → "< 1 min"
 * < 1hr  → "X mins"
 * else   → "Xh Ym"
 */
function formatSecondsToText(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes)} min${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours)}h ${String(mins)}m`;
}
