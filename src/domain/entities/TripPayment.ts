import type { Money } from './Money';
import type { PaymentMethodId } from './PaymentMethodId';

/**
 * A payment row from the receipt subcollection
 * (`trips/{tripId}/payments/{paymentId}`). Written exclusively by the
 * Stripe webhook → Cloud Function pipeline; client cannot write
 * (Firestore rules deny). Lightweight value object.
 *
 * `paymentMethodId` is the Stripe `pm_…` id of the saved card the charge
 * was applied against (or `null` for legacy rows / refund rows where the
 * Stripe webhook didn't carry one). The webhook server
 * (yeride-stripe-server/stripe/routes.js:138) writes
 * `pi.payment_method` on every fare / tip charge as `paymentMethodId`.
 * The receipt screen joins this against the rider's wallet cache
 * (`useListPaymentMethodsQuery`) to surface card brand + last-4 — Phase 9
 * Turn 7 wired this. Refund rows + legacy pre-Turn-7 fare rows that
 * lacked the field surface as `null` and the receipt falls back to
 * "Charged to your card on file."
 */

export type TripPaymentType = 'fare' | 'tip' | 'refund';
export type TripPaymentStatus = 'succeeded' | 'failed' | 'refunded';

export interface TripPayment {
  readonly id: string;
  readonly type: TripPaymentType;
  readonly amount: Money;
  readonly status: TripPaymentStatus;
  readonly createdAt: Date;
  /**
   * Stripe `pm_…` id of the card the charge was applied against. `null`
   * when the wire payload didn't carry it (refund rows, pre-Turn-7
   * legacy rows, or a webhook write that omitted the field). Receipt
   * screen renders a brand-agnostic fallback when null.
   */
  readonly paymentMethodId: PaymentMethodId | null;
}
