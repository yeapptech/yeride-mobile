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
  return Result.ok({
    tripId: tripIdR.value,
    tripStatus: d.tripStatus,
    destination: {
      type: d.destination.type,
      location: destLocR.value,
    },
  });
}

export function toDoc(loc: UserLocation): UserLocationDoc {
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

function tripTrackingToDoc(t: TripTracking): TripTrackingDoc {
  return {
    tripId: String(t.tripId),
    tripStatus: t.tripStatus,
    destination: {
      type: t.destination.type,
      latitude: t.destination.location.latitude,
      longitude: t.destination.location.longitude,
    },
  };
}
