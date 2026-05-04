import { Money } from '@domain/entities/Money';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import type { TripPayment } from '@domain/entities/TripPayment';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import {
  TripPaymentDocSchema,
  type TripPaymentDoc,
} from '../dto/TripPaymentDoc';

const logger = LOG.extend('tripPaymentMapper');

/**
 * Read-only mapper: Firestore `trips/{tripId}/payments/{paymentId}` doc →
 * domain `TripPayment` value object.
 *
 * Payment rows are written exclusively by the Stripe webhook → Cloud
 * Function pipeline (Firestore rules deny client writes). The client uses
 * them to render the receipt screen.
 *
 * Money on the wire is INTEGER CENTS — Stripe-native unit. The webhook
 * server (yeride-stripe-server/stripe/routes.js:132) writes the raw
 * `pi.amount` from the Stripe Charge/PaymentIntent, which is always an
 * integer in the smallest currency unit. The mapper passes that
 * directly to `Money.create(cents, 'USD')`. (Pre-Phase-9-turn-4-smoke-
 * fix-2 the mapper used `Money.fromMajor` which interpreted `amount`
 * as dollars — a 100x bug that surfaced as $5 charges rendering as
 * $500 on the receipt.)
 *
 * `paymentMethodId` is parsed defensively. The webhook server writes
 * `pi.payment_method` (Stripe `pm_…` id) on fare / tip charges (see
 * yeride-stripe-server/stripe/routes.js:138); refund rows + legacy
 * pre-Phase-9-Turn-7 fare rows omit it. Missing / `null` on the wire
 * → domain `paymentMethodId: null`. Present-but-malformed (validation
 * fails on the `pm_…` prefix) → `LOG.warn` + `null` so the receipt
 * still renders rather than the entire payment row failing — same
 * legacy-doc resilience pattern as `userMapper`'s Stripe id handling.
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
  // `doc.amount` is integer cents (Stripe-native); `Money.create` takes
  // minor units directly. Do NOT use `Money.fromMajor` here — that
  // interprets the input as dollars and produces a 100x overcount.
  const amountR = Money.create(doc.amount, 'USD');
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

  // Defensive parse of paymentMethodId. Missing / null on the wire →
  // null. Present-but-malformed → LOG.warn + null so the receipt still
  // renders. The receipt VM joins this against the wallet cache; null
  // surfaces a brand-agnostic "Charged to your card on file" fallback.
  let paymentMethodId: PaymentMethodId | null = null;
  if (doc.paymentMethodId != null) {
    const pmR = PaymentMethodId.create(doc.paymentMethodId);
    if (pmR.ok) {
      paymentMethodId = pmR.value;
    } else {
      logger.warn(
        '[toDomain] payment doc has malformed paymentMethodId; falling back to null',
        { docId, error: pmR.error },
      );
    }
  }

  return Result.ok({
    id: docId,
    type: doc.type,
    amount: amountR.value,
    status: doc.status,
    createdAt: at,
    paymentMethodId,
  });
}
