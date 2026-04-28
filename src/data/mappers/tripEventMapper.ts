import type { TripEvent } from '@domain/entities/TripEvent';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import { TripEventDocSchema, type TripEventDoc } from '../dto/TripEventDoc';

/**
 * Read-only mapper: Firestore `trips/{tripId}/events/{eventId}` doc → the
 * domain `TripEvent` value object used by the audit-log UI.
 *
 * Read-only because Firestore rules deny client writes — events are
 * created by Cloud Functions on every state transition.
 */

export function parseTripEventDoc(
  raw: unknown,
): Result<TripEventDoc, ValidationError> {
  const r = TripEventDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'trip_event_doc_invalid_shape',
        message: `TripEventDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  docId: string,
  doc: TripEventDoc,
): Result<TripEvent, ValidationError> {
  const at = new Date(doc.createdAt);
  if (Number.isNaN(at.getTime())) {
    return Result.err(
      new ValidationError({
        code: 'trip_event_invalid_created_at',
        message: 'createdAt must parse to a valid Date',
        field: 'createdAt',
      }),
    );
  }
  return Result.ok({
    id: docId,
    type: doc.type,
    event: doc.event,
    extras: doc.extras,
    createdAt: at,
  });
}
