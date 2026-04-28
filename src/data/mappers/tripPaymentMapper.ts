import { Money } from '@domain/entities/Money';
import type { TripPayment } from '@domain/entities/TripPayment';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';

import {
  TripPaymentDocSchema,
  type TripPaymentDoc,
} from '../dto/TripPaymentDoc';

/**
 * Read-only mapper: Firestore `trips/{tripId}/payments/{paymentId}` doc →
 * domain `TripPayment` value object.
 *
 * Payment rows are written exclusively by the Stripe webhook → Cloud
 * Function pipeline (Firestore rules deny client writes). The client uses
 * them to render the receipt screen.
 *
 * Money on the wire is plain dollar numbers (matches the rest of the
 * legacy schema); the mapper converts to `Money` USD minor units.
 */

export function parseTripPaymentDoc(
  raw: unknown,
): Result<TripPaymentDoc, ValidationError> {
  const r = TripPaymentDocSchema.safeParse(raw);
  if (!r.success) {
    return Result.err(
      new ValidationError({
        code: 'trip_payment_doc_invalid_shape',
        message: `TripPaymentDoc failed schema validation: ${r.error.message}`,
        cause: r.error,
      }),
    );
  }
  return Result.ok(r.data);
}

export function toDomain(
  docId: string,
  doc: TripPaymentDoc,
): Result<TripPayment, ValidationError> {
  const amountR = Money.fromMajor(doc.amount, 'USD');
  if (!amountR.ok) return amountR;
  const at = new Date(doc.createdAt);
  if (Number.isNaN(at.getTime())) {
    return Result.err(
      new ValidationError({
        code: 'trip_payment_invalid_created_at',
        message: 'createdAt must parse to a valid Date',
        field: 'createdAt',
      }),
    );
  }
  return Result.ok({
    id: docId,
    type: doc.type,
    amount: amountR.value,
    status: doc.status,
    createdAt: at,
  });
}
