import type { Money } from './Money';

/**
 * A payment row from the receipt subcollection
 * (`trips/{tripId}/payments/{paymentId}`). Written exclusively by the
 * Stripe webhook → Cloud Function pipeline; client cannot write
 * (Firestore rules deny). Lightweight value object.
 */

export type TripPaymentType = 'fare' | 'tip' | 'refund';
export type TripPaymentStatus = 'succeeded' | 'failed' | 'refunded';

export interface TripPayment {
  readonly id: string;
  readonly type: TripPaymentType;
  readonly amount: Money;
  readonly status: TripPaymentStatus;
  readonly createdAt: Date;
}
